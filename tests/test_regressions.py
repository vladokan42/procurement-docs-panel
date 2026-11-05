"""Regressions from the original generators; no private templates."""
from docx import Document
import pytest
from app.kp_generator import fill_okk_table


def item(**changes):
    return {"name": "Синтетический товар", "manufacturer": "Демо", "weight_g": 100,
            "pcs_per_box": 3, "vat_rate": 0.20, "price_sale_no_vat": 100,
            "price_sale_with_vat": 120, "cost_with_vat": 80, **changes}


def test_word_preserves_twenty_percent():
    table = Document().add_table(rows=1, cols=9)
    fill_okk_table(table, [item()])
    assert table.rows[1].cells[4].text == "20%"
    assert table.rows[1].cells[6].text == "120,00"


def test_word_never_invents_price_100():
    table = Document().add_table(rows=1, cols=9)
    with pytest.raises(ValueError):
        fill_okk_table(table, [item(price_sale_no_vat=None, price_sale_with_vat=None)])


@pytest.mark.parametrize("vat,gross", [(0,"100,00"),(0.1,"110,00"),(0.2,"120,00"),(0.22,"122,00")])
def test_word_money_and_vat(vat, gross):
    table = Document().add_table(rows=1, cols=9)
    fill_okk_table(table, [item(vat_rate=vat, price_sale_with_vat=None)])
    assert table.rows[1].cells[6].text == gross
    assert table.rows[1].cells[4].text == f"{round(vat*100)}%"
