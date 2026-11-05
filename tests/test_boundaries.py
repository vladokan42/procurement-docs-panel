from io import BytesIO
import openpyxl
import pytest
from test_exports import payload, post, KINDS


@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("field,value", [("pcs_per_box",0),("pcs_per_box",1.5),("pcs_per_box",True),
                                       ("weight_g",-1),("weight_g","NaN"),("boxes_per_pallet",0),
                                       ("boxes_per_row",2.5),("name",""),("name","\x00bad")])
def test_invalid_rows_never_export(client,kind,field,value):
    data=payload(kind);data["items"][0][field]=value
    assert post(client,kind,data).status_code==422


@pytest.mark.parametrize("kind", KINDS)
def test_meta_and_vat_must_be_present(client,kind):
    data=payload(kind);data.pop("meta")
    assert post(client,kind,data).status_code==422
    data=payload(kind);del data["items"][0]["vat_rate"]
    assert post(client,kind,data).status_code==422


def test_invalid_mode_and_body_limit(client):
    data=payload("load");data["spec_type"]="anything"
    assert post(client,"load",data).status_code==422
    res=client.post("/api/kp/generate-excel",content=b" "*(2*1024*1024+1),headers={"Content-Type":"application/json"})
    assert res.status_code==413


def test_decimal_rounding_and_leading_zero_barcode(client):
    data=payload("load");r=data["items"][0];r["price_no_vat"]="1.005";r["vat_rate"]=0.2
    res=post(client,"load",data)
    assert res.status_code==200,res.text
    wb=openpyxl.load_workbook(BytesIO(res.content),data_only=True)
    assert wb.active.cell(10,9).value==1.01
    assert wb.active.cell(10,8).value==1.21
    assert wb.active.cell(10,10).value==3.63
    assert wb.active.cell(10,4).value=="0123456789012"
    wb.close()


def test_generator_errors_leave_no_temporary_exports(client):
    from app.main import EXPORT_DIR
    data=payload("kp");data["items"][0]["price_sale_no_vat"]=None
    assert post(client,"kp",data).status_code==422
    assert not list(EXPORT_DIR.iterdir())
