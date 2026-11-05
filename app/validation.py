"""Shared trust boundary: explicit VAT, Decimal money, plain text only."""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re
import unicodedata

CENT = Decimal("0.01")
VAT_RATES = {Decimal("0"), Decimal("0.10"), Decimal("0.20"), Decimal("0.22")}


def text(value, label="Текст", required=False, limit=500):
    if value is None:
        value = ""
    if not isinstance(value, str) or any(unicodedata.category(c) in {"Cc", "Cf", "Cs"} for c in value):
        raise ValueError(f"{label}: нужен обычный текст без управляющих символов")
    value = value.strip()
    if len(value) > limit or (required and not value):
        raise ValueError(f"{label}: заполните поле, не более {limit} символов")
    return value


def numeric(value, label, *, integer=False, optional=False):
    if optional and value in (None, ""):
        return None
    if isinstance(value, bool) or value in (None, ""):
        raise ValueError(f"{label}: нужно положительное число")
    try:
        value = Decimal(str(value).replace(" ", "").replace("\u00a0", "").replace(",", "."))
    except InvalidOperation:
        raise ValueError(f"{label}: неверное число") from None
    if not value.is_finite() or not Decimal("0") < value <= Decimal("1000000000"):
        raise ValueError(f"{label}: число должно быть конечным, больше 0 и не больше 1 000 000 000")
    if integer:
        if value != value.to_integral_value() or value > 1000000:
            raise ValueError(f"{label}: нужно целое число от 1 до 1 000 000")
        return int(value)
    value = value.quantize(CENT, rounding=ROUND_HALF_UP)
    if value <= 0:
        raise ValueError(f"{label}: после округления цена должна быть положительной")
    return value


def vat_rate(value):
    if value is None or isinstance(value, bool):
        raise ValueError("Выберите НДС: 0%, 10%, 20% или 22%")
    try:
        vat = Decimal(str(value))
    except InvalidOperation:
        raise ValueError("Неизвестная ставка НДС") from None
    if not vat.is_finite() or vat not in VAT_RATES:
        raise ValueError("Выберите НДС: 0%, 10%, 20% или 22%")
    return vat


def price_pair(net, gross, vat):
    """Net is canonical; accept gross-only input and at most 1 kopeck round-trip drift."""
    n = numeric(net, "Цена без НДС", optional=True)
    g = numeric(gross, "Цена с НДС", optional=True)
    if n is None and g is None:
        raise ValueError("Укажите цену без НДС или с НДС")
    if n is None:
        n = numeric(g / (1 + vat), "Цена без НДС")
    calculated = (n * (1 + vat)).quantize(CENT, rounding=ROUND_HALF_UP)
    if g is not None and abs(calculated - g) > CENT:
        raise ValueError("Цены с НДС и без НДС не соответствуют выбранной ставке")
    return n, calculated


def normalize_items(items, kind):
    if not isinstance(items, list) or not 1 <= len(items) <= 500:
        raise ValueError("Нужно от 1 до 500 строк; строки сверх лимита не обрезаются")
    result = []
    for index, raw in enumerate(items, 1):
        if not isinstance(raw, dict):
            raise ValueError(f"Строка {index}: нужен объект")
        try:
            item = {k: text(raw.get(k), k, required=k == "name" or (k == "article" and kind in {"load", "change"}))
                    for k in ("article", "name", "manufacturer", "barcode")}
            for k in ("pcs_per_box", "boxes_per_pallet", "boxes_per_row"):
                item[k] = numeric(raw.get(k), k, integer=True, optional=k != "pcs_per_box")
            item["weight_g"] = numeric(raw.get("weight_g"), "Вес", optional=True)
            item["vat_rate"] = vat_rate(raw.get("vat_rate"))
            net, gross = (("price_no_vat", "price_with_vat") if kind in {"load", "change"}
                          else ("price_sale_no_vat", "price_sale_with_vat"))
            item[net], item[gross] = price_pair(raw.get(net), raw.get(gross), item["vat_rate"])
            if kind == "change":
                item["new_price_no_vat"], item["new_price_with_vat"] = price_pair(
                    raw.get("new_price_no_vat"), raw.get("new_price_with_vat"), item["vat_rate"])
            if kind in {"kp", "okk"}:
                item["cost_with_vat"] = numeric(raw.get("cost_with_vat"), "Себестоимость с НДС")
            result.append(item)
        except ValueError as exc:
            raise ValueError(f"Строка {index}: {exc}") from None
    return result


def normalize_meta(meta):
    if not isinstance(meta, dict):
        raise ValueError("Укажите поставщика")
    return {key: text(meta.get(key), key, required=key == "supplier", limit=200)
            for key in ("supplier", "contract", "spec_num_date", "date")}


def excel_text(value):
    value = str(value or "")
    # Text never becomes a formula, including leading whitespace/control tricks.
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value


def safe_filename_supplier(value):
    value = re.sub(r'[/\\:*?"<>|\x00-\x1f\x7f]', "_", value)
    return value.strip(" ._")[:80] or "supplier"
