"""Read-only synthetic JSON; no database, sync or private fallback."""
import json
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parent.parent / "demo" / "catalog.json"


def normalize_article(article):
    # Identifiers remain literal: no guessing, uppercasing or correcting.
    return article.strip()


def lookup_article(article):
    for item in json.loads(CATALOG_PATH.read_text(encoding="utf-8")):
        if item["article"] == normalize_article(article):
            return {**item, "found": True, "source": "Синтетический каталог"}
    return None


def search_catalog(q, limit=25):
    terms = q.casefold().split()
    items = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    return [{**item, "found": True} for item in items
            if all(t in (item["name"] + " " + item["article"]).casefold() for t in terms)][:limit]
