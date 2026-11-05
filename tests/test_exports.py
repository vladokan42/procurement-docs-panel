from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote
from zipfile import ZipFile
import openpyxl
from docx import Document
import pytest
from app.kp_generator import generate_okk_docx
from app.spec_generator import parse_articles_text

ENDPOINTS = ["/api/specs/generate", "/api/specs/generate", "/api/kp/generate-excel", "/api/kp/generate-docx"]
KINDS = ["load", "change", "kp", "okk"]


def row(i=1, vat=0.2):
    return {"article": f"MANUAL-{i}", "name": f"Свободное имя {i}", "manufacturer": "Демо",
            "weight_g": 100, "barcode": "0123456789012", "pcs_per_box": 3,
            "boxes_per_pallet": 10, "boxes_per_row": 5, "vat_rate": vat,
            "price_no_vat": 100, "price_with_vat": None, "new_price_no_vat": 150,
            "new_price_with_vat": None, "price_sale_no_vat": 100,
            "price_sale_with_vat": None, "cost_with_vat": 80}


def payload(kind, count=1):
    data = {"items": [row(i+1) for i in range(count)],
            "meta": {"supplier": "Демонстрационный поставщик", "date": "06.11.2026"}}
    if kind in {"load", "change"}: data["spec_type"] = kind
    return data


def post(client, kind, data=None):
    return client.post(ENDPOINTS[KINDS.index(kind)], json=data or payload(kind))


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("count", [1,9,25])
def test_saved_documents_keep_all_rows_and_computed_values(client, tmp_path, kind, count):
    res = post(client, kind, payload(kind, count))
    assert res.status_code == 200, res.text
    suffix = ".docx" if kind == "okk" else ".xlsx"
    path = tmp_path / (kind + suffix)
    path.write_bytes(res.content)
    with ZipFile(path) as z:
        assert not any("externalLinks" in n or "/media/" in n or "vbaProject" in n for n in z.namelist())
    if kind == "okk":
        doc = Document(path)
        assert len(doc.tables) == 1
        assert len(doc.tables[0].rows) == count + 1
        assert doc.tables[0].rows[count].cells[0].text == f"Свободное имя {count}"
        assert doc.tables[0].rows[1].cells[4].text == "20%"
        assert doc.tables[0].rows[1].cells[6].text == "120,00"
        assert doc.tables[0].rows[1].cells[8].text == "360,00"
        assert any("Демонстрационный поставщик" in p.text for p in doc.paragraphs)
        assert any("360,00" in p.text for p in doc.paragraphs) if count == 1 else True
        return
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    start = {"load":10, "change":8, "kp":3}[kind]
    assert ws.cell(start+count-1, 2).value == f"Свободное имя {count}"
    assert ws.cell(3 if kind != "kp" else 1, 2).value == "Демонстрационный поставщик"
    assert ws.cell(start, {"load":7,"change":7,"kp":6}[kind]).value == 0.2
    assert ws.cell(start, 8).value == 120
    if kind == "change":
        assert ws.cell(start, 13).value == 180
        assert ws.cell(start, 17).value == 0.5
        assert ws.cell(start+count, 15).value == count * 540
    else:
        assert ws.cell(start+count, 10).value == count * 360
    wb.close()


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("supplier", [None,"","   "])
def test_supplier_required_every_export(client, kind, supplier):
    data = payload(kind)
    data["meta"]["supplier"] = supplier
    assert post(client, kind, data).status_code == 422


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("vat,gross", [(0,100),(0.1,110),(0.2,120),(0.22,122)])
def test_explicit_vat_math(client, kind, vat, gross):
    data = payload(kind)
    data["items"][0]["vat_rate"] = vat
    res = post(client, kind, data)
    assert res.status_code == 200, res.text
    if kind == "okk":
        cells = Document(BytesIO(res.content)).tables[0].rows[1].cells
        assert cells[4].text == {0:"0%",0.1:"10%",0.2:"20%",0.22:"22%"}[vat]
        assert cells[6].text == {100:"100,00",110:"110,00",120:"120,00",122:"122,00"}[gross]
    else:
        wb = openpyxl.load_workbook(BytesIO(res.content),data_only=True)
        start = {"load":10,"change":8,"kp":3}[kind]
        assert wb.active.cell(start,8).value == gross
        wb.close()


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("vat", [None,-0.1,0.18,10,"unknown",True])
def test_unknown_vat_never_defaulted(client, kind, vat):
    data=payload(kind); data["items"][0]["vat_rate"]=vat
    assert post(client, kind, data).status_code == 422


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("bad", [None,0,-1,"NaN","Infinity","-Infinity","oops",True,1e40,0.001])
def test_prices_finite_positive_no_default(client, kind, bad):
    data=payload(kind)
    key="price_no_vat" if kind in {"load","change"} else "price_sale_no_vat"
    data["items"][0][key]=bad
    assert post(client, kind, data).status_code == 422


@pytest.mark.parametrize("kind", KINDS)
def test_accept_gross_only_and_reject_inconsistent_pair(client, kind):
    data=payload(kind); r=data["items"][0]
    net,gross = ("price_no_vat","price_with_vat") if kind in {"load","change"} else ("price_sale_no_vat","price_sale_with_vat")
    r[net]=None; r[gross]=120
    assert post(client,kind,data).status_code==200
    r[net]=100; r[gross]=999
    assert post(client,kind,data).status_code==422


@pytest.mark.parametrize("kind", ["load","change","kp"])
@pytest.mark.parametrize("prefix", ["=","+","-","@","  ="])
def test_text_cells_neutralize_formula_injection(client,kind,prefix):
    data=payload(kind); text=prefix+'HYPERLINK("https://example.invalid","x")'
    data["meta"]["supplier"]=text
    for key in ["name","article","manufacturer","barcode"]: data["items"][0][key]=text
    res=post(client,kind,data)
    assert res.status_code==200, res.text
    wb=openpyxl.load_workbook(BytesIO(res.content),data_only=False)
    ws=wb.active; start={"load":10,"change":8,"kp":3}[kind]
    assert ws.cell(start,2).value.startswith("'")
    assert not any(c.data_type=="f" for rows in ws for c in rows)
    assert ws.cell(1 if kind=="kp" else 3,2).value.startswith("'")
    wb.close()


@pytest.mark.parametrize("kind",KINDS)
def test_safe_supplier_download_name(client, kind):
    data=payload(kind); data["meta"]["supplier"]='../../Фабрика "Демо":*?\\<x>'
    res=post(client,kind,data)
    assert res.status_code==200, res.text
    name=unquote(res.headers["content-disposition"].split("UTF-8''")[1])
    assert "Фабрика" in name
    assert not any(c in name for c in '/\\:"*?<>\r\n')


@pytest.mark.parametrize("kind", KINDS)
def test_controls_rejected_and_resource_limits(client, kind):
    data=payload(kind); data["meta"]["supplier"]="bad\r\nheader"
    assert post(client,kind,data).status_code==422
    data=payload(kind,501)
    assert post(client,kind,data).status_code==422
    data=payload(kind);data["items"]=[]
    assert post(client,kind,data).status_code==422
    data=payload(kind);data["items"][0]["name"]="x"*501
    assert post(client,kind,data).status_code==422


def test_manual_identifiers_and_catalog_is_synthetic(client):
    assert parse_articles_text("demo-001; demo-001\nUNKNOWN-01") == ["demo-001","UNKNOWN-01"]
    found=client.get("/api/specs/lookup",params={"article":"DEMO-001"}).json()
    assert found["found"] is True
    assert found["vat_rate"] == 0
    unknown=client.get("/api/specs/lookup",params={"article":"UNKNOWN-01"}).json()
    assert unknown["found"] is False
    assert unknown["article"] == "UNKNOWN-01"
    assert unknown["vat_rate"] is None
    assert unknown["price_no_vat"] is None
    preview=client.post("/api/specs/preview",json={"raw_text":"DEMO-001;UNKNOWN-01"}).json()
    assert len(preview)==2
    assert preview[1]["name"] == ""
    assert post(client,"load").status_code==200
    assert post(client,"kp").status_code==200


def test_parallel_exports_use_separate_temporary_paths_and_cleanup(client):
    from app.main import EXPORT_DIR
    with ThreadPoolExecutor(max_workers=4) as pool:
        responses=list(pool.map(lambda i: post(client,"kp",payload("kp",i)),[1,2,3,4]))
    assert [r.status_code for r in responses]==[200]*4
    counts=[]
    for res in responses:
        wb=openpyxl.load_workbook(BytesIO(res.content))
        counts.append(sum(str(row[1].value).startswith("Свободное имя") for row in wb.active))
        wb.close()
    assert counts==[1,2,3,4]
    assert list(EXPORT_DIR.iterdir())==[]
