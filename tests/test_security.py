import pytest
from test_exports import payload


@pytest.mark.parametrize("host",["evil.test","127.0.0.1.evil.test","203.0.113.1","localhost@evil.test","127.0.0.1:99999"])
def test_host_allowlist(client,host):
    assert client.get("/",headers={"host":host}).status_code==400


@pytest.mark.parametrize("origin",["https://evil.test","http://localhost:8098","null","http://127.0.0.1:9999"])
@pytest.mark.parametrize("method,path",[("GET","/api/catalog/search"),("POST","/api/kp/generate-excel")])
def test_exact_origin_and_port(client,origin,method,path):
    kwargs={"headers":{"Origin":origin}}
    if method=="POST": kwargs["json"]=payload("kp")
    assert client.request(method,path,**kwargs).status_code==403


@pytest.mark.parametrize("site",["cross-site","same-site"])
def test_fetch_metadata_rejects_cross_origin_download(client,site):
    assert client.get("/",headers={"Sec-Fetch-Site":site}).status_code==403


def test_custom_header_and_json_required(client):
    assert client.post("/api/kp/generate-excel",json=payload("kp"),headers={"X-Panel-Request":""}).status_code==403
    assert client.post("/api/kp/generate-excel",content="items=",headers={"Content-Type":"text/plain"}).status_code==415
    assert client.options("/api/kp/generate-excel",headers={"Origin":"https://evil.test","Access-Control-Request-Method":"POST"}).status_code==403
    res=client.post("/api/kp/generate-excel",json=payload("kp"),headers={"Origin":"http://127.0.0.1:8098","Sec-Fetch-Site":"same-origin"})
    assert res.status_code==200
    assert "access-control-allow-origin" not in res.headers


def test_security_headers_no_remote_js_and_removed_integrations(client):
    res=client.get("/")
    assert res.status_code==200
    assert res.headers["x-frame-options"]=="DENY"
    assert res.headers["x-content-type-options"]=="nosniff"
    assert res.headers["cache-control"]=="no-store"
    assert "connect-src 'self'" in res.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in res.headers["content-security-policy"]
    assert 'src="http' not in res.text
    assert client.get("/docs").status_code==404
    assert client.get("/api/specs/history").status_code==404
    assert client.post("/api/specs/universal-sync",json={}).status_code==404
    assert client.get("/static/../../app/main.py").status_code==404
    assert client.get("/.env").status_code==404
