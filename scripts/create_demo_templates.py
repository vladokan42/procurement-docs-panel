"""Build neutral forms from code, never from corporate workbooks/documents."""
from pathlib import Path
from tempfile import NamedTemporaryFile
import os
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from docx import Document
from docx.enum.section import WD_ORIENT
from docx.shared import Cm, Pt

PROJECT_DIR = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = PROJECT_DIR / "generated" / "templates"
LOAD_HEADERS = ["Артикул", "Наименование", "Вес, г", "Штрихкод", "Шт/кор", "Кор/пал", "НДС",
                "Цена/шт с НДС", "Цена/шт без НДС", "Цена/кор с НДС", "Цена/кор без НДС"]
CHANGE_HEADERS = ["Артикул", "Наименование", "Вес, г", "Шт/кор", "Кор/пал", "Кор/ряд", "НДС",
                  "Старая шт с НДС", "Старая шт без НДС", "Старая кор с НДС", "Старая кор без НДС", "",
                  "Новая шт с НДС", "Новая шт без НДС", "Новая кор с НДС", "Новая кор без НДС", "Изменение, %"]
KP_HEADERS = ["Наименование", "Производитель", "Вес, г", "Шт/кор", "НДС", "Цена/шт без НДС",
              "Цена/шт с НДС", "Цена/кор без НДС", "Цена/кор с НДС", "", "Себестоимость с НДС", "Наценка"]
WORD_HEADERS = ["Наименование", "Производитель", "Вес, г", "Шт/кор", "НДС", "Шт без НДС", "Шт с НДС", "Кор без НДС", "Кор с НДС"]


def atomic_save(document, path):
    with NamedTemporaryFile(dir=path.parent, suffix=path.suffix, delete=False) as f:
        candidate = Path(f.name)
    try:
        document.save(candidate)
        os.replace(candidate, path)
    finally:
        candidate.unlink(missing_ok=True)


def create_workbook(path, sheet, title, headers, header_row, first_col=1):
    wb = openpyxl.Workbook()
    wb.properties.creator = "Vladislav Okan"
    wb.properties.lastModifiedBy = "Vladislav Okan"
    ws = wb.active
    ws.title = sheet
    if first_col == 1:
        ws.cell(1,1,title + " — учебная форма")
        ws.cell(3,1,"Поставщик")
        ws.cell(4,1,"Договор")
        ws.cell(5,1,"Спецификация / дата")
    else:
        ws.cell(1,1,"Поставщик")
        ws.cell(1,4,title + " — учебная форма")
    side = Side(style="thin", color="CBD5E1")
    border = Border(left=side, right=side, top=side, bottom=side)
    for col, header in enumerate(headers, first_col):
        cell = ws.cell(header_row, col, header)
        cell.font = Font(name="Calibri", bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="263344")
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(col)].width = 18 if col != 2 else 45
        prototype = ws.cell(header_row+1, col)
        prototype.border = border
        prototype.font = Font(name="Calibri", size=11)
        prototype.alignment = Alignment(vertical="center", wrap_text=True)
        prototype.number_format = "0.00"
    ws.row_dimensions[header_row].height = 36
    ws.freeze_panes = f"C{header_row+1}"
    ws.sheet_view.zoomScale = 85
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    atomic_save(wb, path)
    wb.close()


def create_demo_templates():
    # No path argument: startup can write only below this source tree.
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    forms = [("template_spec_load.xlsx","Спецификация","Прогрузка цен",LOAD_HEADERS,9,1),
             ("template_spec_change.xlsx","Повышение цены","Изменение цен",CHANGE_HEADERS,7,1),
             ("template_kp.xlsx","Лист1","Коммерческое предложение",KP_HEADERS,2,2)]
    for filename,sheet,title,headers,row,col in forms:
        path=TEMPLATES_DIR / filename
        if not path.exists():
            create_workbook(path,sheet,title,headers,row,col)
    path=TEMPLATES_DIR / "template_okk.docx"
    if not path.exists():
        doc=Document()
        doc.core_properties.author="Vladislav Okan"
        doc.core_properties.last_modified_by="Vladislav Okan"
        doc.add_paragraph("Коммерческое предложение от {date}", "Title")
        doc.add_paragraph("Поставщик: {supplier}")
        doc.add_paragraph("Учебная форма. Цены в рублях. Без реквизитов, подписей и печатей.")
        section=doc.sections[0]
        section.orientation=WD_ORIENT.LANDSCAPE
        section.page_width=Cm(29.7); section.page_height=Cm(21)
        section.left_margin=Cm(1); section.right_margin=Cm(1)
        doc.styles["Normal"].font.name="Calibri"
        doc.styles["Normal"].font.size=Pt(10)
        table=doc.add_table(rows=1,cols=9)
        table.style="Table Grid"
        for cell,label in zip(table.rows[0].cells, WORD_HEADERS): cell.text=label
        atomic_save(doc,path)
    return TEMPLATES_DIR


if __name__ == "__main__":
    print(create_demo_templates())
