"""Local-only adaptation of category-panel routes; no accounts or integrations."""
from contextlib import asynccontextmanager
from pathlib import Path
import re
import tempfile
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.datastructures import Headers, MutableHeaders
from urllib.parse import quote

from scripts.create_demo_templates import create_demo_templates
from .catalog import search_catalog
from .kp_generator import generate_kp_excel, generate_okk_docx
from .spec_generator import (generate_specification_load, generate_specification_change,
                             parse_articles_text, preview_specification_items)
from .validation import normalize_meta, safe_filename_supplier, text

BASE_DIR = Path(__file__).resolve().parent.parent
EXPORT_DIR = BASE_DIR / "generated" / "exports"
MAX_BODY = 2 * 1024 * 1024
SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
}


class LocalOnlyMiddleware:
    """Exact Host/Origin, Fetch Metadata, custom JSON header and bounded body."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)

        async def secure_send(message):
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                response_headers.update(SECURITY_HEADERS)
            await send(message)

        async def deny(status, detail):
            await JSONResponse({"detail": detail}, status_code=status)(scope, receive, secure_send)

        host = headers.get("host", "")
        match = re.fullmatch(r"(127\.0\.0\.1|localhost|\[::1\])(?::([1-9][0-9]{0,4}))?", host)
        if len(headers.getlist("host")) != 1 or not match or (match[2] and int(match[2]) > 65535):
            return await deny(400, "Разрешён только локальный Host: 127.0.0.1, localhost или [::1]")
        origin = headers.get("origin")
        if len(headers.getlist("origin")) > 1 or (origin is not None and origin != f"{scope.get('scheme', 'http')}://{host}"):
            return await deny(403, "Запрос должен исходить с этого же локального адреса и порта")
        if headers.get("sec-fetch-site", "none") not in {"same-origin", "none"}:
            return await deny(403, "Межсайтовые запросы запрещены")
        if scope["method"] == "POST":
            if headers.get("x-panel-request") != "1":
                return await deny(403, "Нужен заголовок X-Panel-Request: 1")
            if headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                return await deny(415, "Принимается только application/json")
            body = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                body.extend(message.get("body", b""))
                if len(body) > MAX_BODY:
                    return await deny(413, "Размер запроса не должен превышать 2 МиБ")
                if not message.get("more_body", False):
                    break
            original_receive = receive
            delivered = False

            async def receive_body():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await original_receive()
            receive = receive_body
        await self.app(scope, receive, secure_send)


@asynccontextmanager
async def lifespan(app):
    create_demo_templates()
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Панель спецификаций и КП — локальная демонстрация", version="1.0.0",
              lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(LocalOnlyMiddleware)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", response_class=HTMLResponse)
def index_page():
    return HTMLResponse((BASE_DIR / "templates" / "index.html").read_text(encoding="utf-8"))


@app.get("/api/catalog/search")
@app.get("/api/specs/search-name")
def catalog_search_endpoint(q: str = Query("", max_length=200)):
    return search_catalog(q)


@app.get("/api/specs/lookup")
def spec_lookup_endpoint(article: str = Query(..., min_length=1, max_length=500)):
    try:
        return preview_specification_items([text(article, "Артикул", required=True)])[0]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


class SpecPreviewRequest(BaseModel):
    raw_text: str = Field(max_length=50000)


@app.post("/api/specs/preview")
def spec_preview_endpoint(payload: SpecPreviewRequest):
    articles = parse_articles_text(payload.raw_text)
    if len(articles) > 500:
        raise HTTPException(422, "Не более 500 артикулов; список не обрезается")
    try:
        for article in articles:
            text(article, "Артикул", required=True)
        return preview_specification_items(articles)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


class KpGenerateRequest(BaseModel):
    items: list[dict[str, Any]] = Field(min_length=1, max_length=500)
    meta: dict[str, Any] | None = None


class SpecGenerateRequest(KpGenerateRequest):
    spec_type: Literal["load", "change"]


def export_document(payload, kind):
    generators = {"load": generate_specification_load, "change": generate_specification_change,
                  "kp": generate_kp_excel, "okk": generate_okk_docx}
    labels = {"load": "Спецификация-прогрузка", "change": "Спецификация-изменение", "kp": "КП", "okk": "ОКК"}
    try:
        meta = normalize_meta(payload.meta)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    temporary = tempfile.TemporaryDirectory(prefix="export-", dir=EXPORT_DIR)
    suffix = ".docx" if kind == "okk" else ".xlsx"
    path = Path(temporary.name) / ("document" + suffix)
    try:
        generators[kind](payload.items, meta, path)
        filename = f"{labels[kind]} ({safe_filename_supplier(meta['supplier'])}){suffix}"
        media = ("application/vnd.openxmlformats-officedocument.wordprocessingml.document" if kind == "okk"
                 else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        return FileResponse(path, media_type=media,
                            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}"},
                            background=BackgroundTask(temporary.cleanup))
    except ValueError as exc:
        temporary.cleanup()
        raise HTTPException(422, str(exc)) from None
    except Exception:
        temporary.cleanup()
        raise


@app.post("/api/specs/generate")
def spec_generate_endpoint(payload: SpecGenerateRequest):
    return export_document(payload, payload.spec_type)


@app.post("/api/kp/generate-excel")
def kp_excel_endpoint(payload: KpGenerateRequest):
    return export_document(payload, "kp")


@app.post("/api/kp/generate-docx")
def kp_docx_endpoint(payload: KpGenerateRequest):
    return export_document(payload, "okk")
