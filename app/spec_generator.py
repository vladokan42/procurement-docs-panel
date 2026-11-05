"""Адаптация исходного генератора: нейтральные формы и проверенные цены."""

from __future__ import annotations

import copy
from decimal import Decimal
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import openpyxl

from .catalog import lookup_article, normalize_article
from .validation import normalize_items, normalize_meta, excel_text
from scripts.create_demo_templates import TEMPLATES_DIR

TEMPLATE_SPEC_LOAD = TEMPLATES_DIR / "template_spec_load.xlsx"
TEMPLATE_SPEC_CHANGE = TEMPLATES_DIR / "template_spec_change.xlsx"


def parse_articles_text(raw_text: str) -> List[str]:
    """Разбивает текст из формы (переводы строк, запятые, точки с запятой) на список артикулов."""
    if not raw_text:
        return []
    tokens = re.split(r"[\r\n,;]+", raw_text)
    seen = set()
    articles = []
    for t in tokens:
        clean = normalize_article(t)
        if clean and clean not in seen:
            seen.add(clean)
            articles.append(clean)
    return articles


def preview_specification_items(articles: List[str]) -> List[Dict[str, Any]]:
    """Синтетический каталог или ручной ввод без выдуманной ставки НДС."""
    rows = []
    for art in articles:
        found = lookup_article(art)
        rows.append(found if found else {
            "article": art, "name": "", "barcode": "", "weight_g": None,
            "pcs_per_box": 1, "boxes_per_pallet": None, "boxes_per_row": None,
            "vat_rate": None, "price_no_vat": None, "price_with_vat": None,
            "found": False, "source": "Вручную"})
    return rows


def generate_specification_load(
    items: List[Dict[str, Any]],
    meta: Optional[Dict[str, Any]] = None,
    output_path: Optional[Path] = None,
) -> Path:
    """Генерирует Excel по форме спецификации для прогрузки цен (Приложение к договору)."""
    items = normalize_items(items, "load")
    meta = normalize_meta(meta)
    if not TEMPLATE_SPEC_LOAD.exists():
        raise FileNotFoundError(f"Шаблон не найден: {TEMPLATE_SPEC_LOAD}")

    if output_path is None:
        raise ValueError("output_path must be specified")

    wb = openpyxl.load_workbook(str(TEMPLATE_SPEC_LOAD), data_only=False)
    ws = wb["Спецификация"]

    start_row = 10
    total_items = len(items)
    for row_num, key in [(3,"supplier"),(4,"contract"),(5,"spec_num_date")]:
        ws.cell(row_num, 2, excel_text(meta[key]))

    # Заполняем строки данными
    for idx, item in enumerate(items):
        r = start_row + idx

        # Артикул
        ws.cell(r, 1, excel_text(item["article"]))
        # Наименование
        ws.cell(r, 2, excel_text(item["name"]))
        # Вес шт, гр.
        ws.cell(r, 3, item.get("weight_g"))
        # Штрих - код Товара
        ws.cell(r, 4, excel_text(item["barcode"]))
        # Шт/Кор
        pcs = item["pcs_per_box"]
        ws.cell(r, 5, pcs)
        # Кор/Пал
        ws.cell(r, 6, item.get("boxes_per_pallet"))
        # Ставка НДС, %
        vat = item["vat_rate"]
        ws.cell(r, 7, vat)

        # Формула цены шт с НДС
        ws.cell(r, 8, item["price_with_vat"])

        # Цена/шт без НДС
        ws.cell(r, 9, item["price_no_vat"])

        # Цена/кор с НДС
        ws.cell(r, 10, item["price_with_vat"] * pcs)
        # Цена/кор без НДС
        ws.cell(r, 11, item["price_no_vat"] * pcs)

    # Очищаем строки ниже последнего элемента, если они были предзаполнены формулами
    for r in range(start_row + total_items, ws.max_row + 1):
        for c in range(1, 12):
            cell = ws.cell(r, c)
            if cell.__class__.__name__ != "MergedCell":
                cell.value = None

    for r in range(start_row, start_row + total_items):
        for c in range(1, ws.max_column + 1):
            cell = ws.cell(r, c)
            if r != start_row:
                cell._style = copy.copy(ws.cell(start_row, c)._style)
            if isinstance(cell.value, (int, float, Decimal)):
                cell.number_format = "0%" if c == 7 else "#,##0.00"
            elif cell.value is not None:
                cell.number_format = "@"
    end_row = start_row + total_items
    ws.cell(end_row, 2, "Итого: по одной коробке каждой позиции")
    for column in ([10, 11] if start_row == 10 else [10, 11, 15, 16]):
        ws.cell(end_row, column, sum(Decimal(str(ws.cell(r, column).value)) for r in range(start_row, end_row)))
        ws.cell(end_row, column).number_format = "#,##0.00"
    ws.print_area = f"A1:{openpyxl.utils.get_column_letter(ws.max_column)}{end_row}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(output_path))
    wb.close()
    return output_path


def generate_specification_change(
    items: List[Dict[str, Any]],
    meta: Optional[Dict[str, Any]] = None,
    output_path: Optional[Path] = None,
) -> Path:
    """Генерирует Excel по форме спецификации на изменение (повышение) цен."""
    items = normalize_items(items, "change")
    meta = normalize_meta(meta)
    if not TEMPLATE_SPEC_CHANGE.exists():
        raise FileNotFoundError(f"Шаблон не найден: {TEMPLATE_SPEC_CHANGE}")

    if output_path is None:
        raise ValueError("output_path must be specified")

    wb = openpyxl.load_workbook(str(TEMPLATE_SPEC_CHANGE), data_only=False)
    ws = wb["Повышение цены"]

    # Мета-данные шапки
    if meta:
        if meta.get("supplier"):
            ws.cell(3, 2, excel_text(meta["supplier"]))
        if meta.get("contract"):
            ws.cell(4, 2, excel_text(meta["contract"]))
        if meta.get("spec_num_date"):
            ws.cell(5, 2, excel_text(meta["spec_num_date"]))

    start_row = 8
    total_items = len(items)

    for idx, item in enumerate(items):
        r = start_row + idx

        # A: Артикул
        ws.cell(r, 1, excel_text(item["article"]))
        # B: Наименование
        ws.cell(r, 2, excel_text(item["name"]))
        # C: Вес шт (г)
        ws.cell(r, 3, item.get("weight_g"))
        # D: Шт/Кор
        pcs = item["pcs_per_box"]
        ws.cell(r, 4, pcs)
        # E: Кор/Пал
        ws.cell(r, 5, item.get("boxes_per_pallet"))
        # F: Кор/Ряд
        ws.cell(r, 6, item.get("boxes_per_row"))
        # G: Ставка НДС
        vat = item["vat_rate"]
        ws.cell(r, 7, vat)

        # H: Цена/шт с НДС
        ws.cell(r, 8, item["price_with_vat"])
        # I: Цена/шт без НДС (текущая)
        old_price = item["price_no_vat"]
        ws.cell(r, 9, float(old_price) if old_price is not None else None)
        # J: Цена/кор с НДС
        ws.cell(r, 10, item["price_with_vat"] * pcs)
        # K: Цена/кор без НДС
        ws.cell(r, 11, item["price_no_vat"] * pcs)

        # M: Новая цена шт с НДС
        ws.cell(r, 13, item["new_price_with_vat"])
        # N: Новая цена шт без НДС
        new_price = item.get("new_price_no_vat")
        ws.cell(r, 14, float(new_price) if new_price is not None else None)
        # O: Новая цена кор с НДС
        ws.cell(r, 15, item["new_price_with_vat"] * pcs)
        # P: Новая цена кор без НДС
        ws.cell(r, 16, item["new_price_no_vat"] * pcs)
        # Q: % повышения
        ws.cell(r, 17, (item["new_price_no_vat"] / item["price_no_vat"]) - 1)

    # Очищаем неиспользованные строки
    for r in range(start_row + total_items, ws.max_row + 1):
        for c in range(1, 18):
            cell = ws.cell(r, c)
            if cell.__class__.__name__ != "MergedCell":
                cell.value = None

    for r in range(start_row, start_row + total_items):
        for c in range(1, ws.max_column + 1):
            cell = ws.cell(r, c)
            if r != start_row:
                cell._style = copy.copy(ws.cell(start_row, c)._style)
            if isinstance(cell.value, (int, float, Decimal)):
                cell.number_format = "0%" if c == 7 else "#,##0.00"
            elif cell.value is not None:
                cell.number_format = "@"
    end_row = start_row + total_items
    ws.cell(end_row, 2, "Итого: по одной коробке каждой позиции")
    for column in ([10, 11] if start_row == 10 else [10, 11, 15, 16]):
        ws.cell(end_row, column, sum(Decimal(str(ws.cell(r, column).value)) for r in range(start_row, end_row)))
        ws.cell(end_row, column).number_format = "#,##0.00"
    ws.print_area = f"A1:{openpyxl.utils.get_column_letter(ws.max_column)}{end_row}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(output_path))
    wb.close()
    return output_path
