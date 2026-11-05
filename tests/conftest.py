from pathlib import Path
import socket
import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Tests must not open network connections")
    monkeypatch.setattr(socket.socket, "connect", blocked)
    monkeypatch.setattr(socket, "create_connection", blocked)


@pytest.fixture
def client():
    with TestClient(app, base_url="http://127.0.0.1:8098", headers={"X-Panel-Request": "1"}) as client:
        yield client
