"""Адаптация генератора КП/ОКК: нейтральные формы без печатей и скрытых наценок."""

from __future__ import annotations

import copy
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Dict, List, Optional

import openpyxl
from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import parse_xml
from docx.shared import Pt

from scripts.create_demo_templates import TEMPLATES_DIR
from .validation import normalize_items, normalize_meta, excel_text, numeric
TEMPLATE_KP_EXCEL = TEMPLATES_DIR / "template_kp.xlsx"
TEMPLATE_OKK_DOCX = TEMPLATES_DIR / "template_okk.docx"

FONT_NAME = "Calibri"
TABLE_FONT_SIZE_PT = 9
TWOPLACES = Decimal("0.01")

BORDER_XML = """<w:tcBorders xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:top w:val="single" w:sz="8" w:space="0" w:color="auto"/>
  <w:left w:val="single" w:sz="8" w:space="0" w:color="auto"/>
  <w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/>
  <w:right w:val="single" w:sz="8" w:space="0" w:color="auto"/>
</w:tcBorders>"""


def dec(value: Any) -> Decimal:
    return numeric(value, "Цена")


def format_money_ru(value: Decimal) -> str:
    """Форматирует число с десятичной запятой: 1234,56"""
    return f"{value:.2f}".replace(".", ",")


def generate_kp_excel(
    items: List[Dict[str, Any]],
    meta: Optional[Dict[str, Any]] = None,
    output_path: Optional[Path] = None,
) -> Path:
    """Генерирует Excel-файл коммерческого предложения по шаблону."""
    items = normalize_items(items, "kp")
    meta = normalize_meta(meta)
    if not TEMPLATE_KP_EXCEL.exists():
        raise FileNotFoundError(f"Шаблон не найден: {TEMPLATE_KP_EXCEL}")
    if output_path is None:
        raise ValueError("output_path must be specified")

    wb = openpyxl.load_workbook(str(TEMPLATE_KP_EXCEL), data_only=False)
    ws = wb["Лист1"]

    # Сохраняем прототипы стилей из шаблона
    main_styles = {}
    for c in range(2, 14):
        src = ws.cell(3, c)
        main_styles[c] = {
            "font": copy.copy(src.font),
            "border": copy.copy(src.border),
            "fill": copy.copy(src.fill),
            "alignment": copy.copy(src.alignment),
            "number_format": src.number_format,
        }

    # Удаляем все строки шаблона ниже строки заголовка 2
    if ws.max_row > 2:
        ws.delete_rows(3, ws.max_row - 2)

    def apply_style(cell: Any, st: Dict[str, Any]) -> None:
        if st.get("font"):
            cell.font = copy.copy(st["font"])
        if st.get("border"):
            cell.border = copy.copy(st["border"])
        if st.get("fill"):
            cell.fill = copy.copy(st["fill"])
        if st.get("alignment"):
            cell.alignment = copy.copy(st["alignment"])
        if st.get("number_format"):
            cell.number_format = st["number_format"]

    ws.cell(1, 2, excel_text(meta["supplier"]))
    ws.cell(1, 11, excel_text(meta["date"]))
    n = len(items)

    # 1. Основная таблица (строки 3 .. 3 + n - 1)
    start_main = 3
    for idx, item in enumerate(items):
        r = start_main + idx
        for c in range(2, 14):
            apply_style(ws.cell(r, c), main_styles[c])

        ws.cell(r, 2, excel_text(item["name"]))
        ws.cell(r, 3, excel_text(item["manufacturer"]))
        ws.cell(r, 4, item.get("weight_g"))
        pcs = item["pcs_per_box"]
        ws.cell(r, 5, pcs)
        vat = item["vat_rate"]
        ws.cell(r, 6, vat)
        ws.cell(r, 7, item["price_sale_no_vat"])

        # Цена за штуку с НДС (продажи)
        price_sale_with_vat = item["price_sale_with_vat"]
        if price_sale_with_vat is not None:
            ws.cell(r, 8, float(price_sale_with_vat))

        ws.cell(r, 9, item["price_sale_no_vat"] * pcs)
        ws.cell(r, 10, item["price_sale_with_vat"] * pcs)

        # Себес (закупочная с НДС)
        cost_with_vat = item["cost_with_vat"]
        if cost_with_vat is not None:
            ws.cell(r, 12, float(cost_with_vat))

        ws.cell(r, 13, (item["price_sale_with_vat"] / item["cost_with_vat"]) - 1)

    for r in range(start_main, start_main + n):
        ws.cell(r,6).number_format = "0%"
        ws.cell(r,13).number_format = "0.0%"
    ws.cell(start_main+n, 2, "Итого: по одной коробке каждой позиции")
    for col in (9,10):
        ws.cell(start_main+n, col, sum(Decimal(str(ws.cell(r,col).value)) for r in range(start_main,start_main+n)))
        ws.cell(start_main+n, col).number_format = "#,##0.00"
    ws.print_area = f"B1:M{start_main+n}"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(output_path))
    wb.close()
    return output_path


def format_doc_cell(
    cell: Any, text: str, align: WD_ALIGN_PARAGRAPH = WD_ALIGN_PARAGRAPH.LEFT
) -> None:
    cell.text = text
    p = cell.paragraphs[0]
    p.alignment = align
    if p.runs:
        run = p.runs[0]
        run.font.name = FONT_NAME
        run.font.size = Pt(TABLE_FONT_SIZE_PT)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
    borders = parse_xml(BORDER_XML)
    cell._tc.get_or_add_tcPr().append(borders)


def fill_okk_table(
    table: Any, items: List[Dict[str, Any]]
) -> None:
    """Заполняет таблицу товаров в Word ОКК."""
    items = normalize_items(items, "okk")
    col_alignments = [
        WD_ALIGN_PARAGRAPH.LEFT,  # Наименование
        WD_ALIGN_PARAGRAPH.CENTER,  # Производитель
        WD_ALIGN_PARAGRAPH.RIGHT,  # Вес, г
        WD_ALIGN_PARAGRAPH.RIGHT,  # Шт. в коробе
        WD_ALIGN_PARAGRAPH.CENTER,  # Ставка НДС
        WD_ALIGN_PARAGRAPH.RIGHT,  # Цена/шт без НДС
        WD_ALIGN_PARAGRAPH.RIGHT,  # Цена/шт с НДС
        WD_ALIGN_PARAGRAPH.RIGHT,  # Цена/кор без НДС
        WD_ALIGN_PARAGRAPH.RIGHT,  # Цена/кор с НДС
    ]

    # Удаляем демо-строки кроме шапки
    while len(table.rows) > 1:
        tr = table.rows[-1]._tr
        tr.getparent().remove(tr)

    for item in items:
        name = item["name"]
        mfg = item["manufacturer"]
        weight_g = str(int(item.get("weight_g") or 0)) if item.get("weight_g") else "—"
        pcs = int(item["pcs_per_box"])

        vat_rate = item["vat_rate"]
        vat_text = f"{int(vat_rate * 100)}%"
        p_no_vat = item["price_sale_no_vat"]
        p_with_vat = item["price_sale_with_vat"]
        box_no_vat = p_no_vat * pcs
        box_with_vat = p_with_vat * pcs

        row_cells = table.add_row().cells
        values = [
            name,
            mfg,
            weight_g,
            str(pcs),
            vat_text,
            format_money_ru(p_no_vat),
            format_money_ru(p_with_vat),
            format_money_ru(box_no_vat),
            format_money_ru(box_with_vat),
        ]

        for i, (val, alignment) in enumerate(zip(values, col_alignments)):
            format_doc_cell(row_cells[i], val, alignment)


def generate_okk_docx(
    items: List[Dict[str, Any]],
    meta: Optional[Dict[str, Any]] = None,
    output_path: Optional[Path] = None,
) -> Path:
    """Нейтральное учебное предложение в Word, одна таблица без подписей."""
    items = normalize_items(items, "okk")
    meta = normalize_meta(meta)
    if not TEMPLATE_OKK_DOCX.exists():
        raise FileNotFoundError(f"Шаблон не найден: {TEMPLATE_OKK_DOCX}")
    if output_path is None:
        raise ValueError("output_path must be specified")

    doc = Document(str(TEMPLATE_OKK_DOCX))

    date_str = (meta.get("date") if meta else None) or datetime.now().strftime("%d.%m.%Y")

    # Подставляем только свободно введённые данные
    for p in doc.paragraphs:
        if "{date}" in p.text or "{supplier}" in p.text:
            p.text = p.text.replace("{date}", date_str).replace("{supplier}", meta["supplier"])
            for run in p.runs:
                run.font.name = FONT_NAME

    fill_okk_table(doc.tables[0], items)
    total_net = sum(item["price_sale_no_vat"] * item["pcs_per_box"] for item in items)
    total_gross = sum(item["price_sale_with_vat"] * item["pcs_per_box"] for item in items)
    doc.add_paragraph(f"Итого по одной коробке каждой позиции: без НДС {format_money_ru(total_net)} руб.; с НДС {format_money_ru(total_gross)} руб.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(str(output_path))
    return output_path
