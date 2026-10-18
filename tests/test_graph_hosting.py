import json

import pytest
from dotenv import dotenv_values
from fastapi.testclient import TestClient

from arcloom.api import create_app
from tests.conftest import ADMIN


def connection(**values):
    return (
        dict(
            host="example.falkordb.cloud",
            port=12345,
            username="falkordb",
            password="private-cloud-password",
            ssl=True,
        )
        | values
    )


def test_graph_target_is_private_staging_not_activation(runtime):
    with TestClient(create_app(runtime.settings, runtime)) as client:
        login = client.post("/api/auth/login", json={"token": ADMIN}).json()
        response = client.post(
            "/api/graph-hosting/target", headers={"X-CSRF-Token": login["csrf"]}, json=connection()
        )
        assert response.status_code == 200
        result = response.json()
        assert result["staged"] and result["target"]["password_configured"]
        assert "private-cloud-password" not in json.dumps(result)
        assert result["current"]["host"] == runtime.settings.graph_host
        target = dotenv_values(
            runtime.settings.data_dir / "private" / "cloud.env", interpolate=False
        )
        assert target["ARCLOOM_GRAPH_PASSWORD"] == "private-cloud-password"
        assert target["ARCLOOM_GRAPH_HOST"] == "example.falkordb.cloud"
        assert "private-cloud-password" not in json.dumps(runtime.store.all("SELECT * FROM events"))


def test_graph_target_requires_admin_and_csrf(runtime, owner):
    from arcloom.domain import Role

    with TestClient(create_app(runtime.settings, runtime)) as client:
        assert client.get("/api/graph-hosting").status_code == 401
        client.post("/api/auth/login", json={"token": ADMIN})
        assert client.post("/api/graph-hosting/target", json=connection()).status_code == 403
        viewer = runtime.auth.add_member(owner, "Readonly hosting", Role.VIEWER)
        client.cookies.clear()
        client.headers["Authorization"] = "Bearer " + viewer["token"]
        assert client.get("/api/graph-hosting").status_code == 403
        assert client.post("/api/graph-hosting/target", json=connection()).status_code == 403


def test_blank_password_cannot_move_credentials_to_different_host(runtime):
    with TestClient(create_app(runtime.settings, runtime)) as client:
        login = client.post("/api/auth/login", json={"token": ADMIN}).json()
        headers = {"X-CSRF-Token": login["csrf"]}
        assert (
            client.post("/api/graph-hosting/target", headers=headers, json=connection()).status_code
            == 200
        )
        assert (
            client.post(
                "/api/graph-hosting/target", headers=headers, json=connection(password="")
            ).status_code
            == 200
        )
        assert (
            client.post(
                "/api/graph-hosting/target",
                headers=headers,
                json=connection(host="different.falkordb.cloud", password=""),
            ).status_code
            == 422
        )


@pytest.mark.parametrize(
    "password", ["quotes'and\\slashes\"$value", "nonascii-密碼-value", "  spaces-are-literal  "]
)
def test_graph_target_password_round_trip(runtime, password):
    with TestClient(create_app(runtime.settings, runtime)) as client:
        login = client.post("/api/auth/login", json={"token": ADMIN}).json()
        response = client.post(
            "/api/graph-hosting/target",
            headers={"X-CSRF-Token": login["csrf"]},
            json=connection(password=password),
        )
        assert response.status_code == 200
        values = dotenv_values(
            runtime.settings.data_dir / "private" / "cloud.env", interpolate=False
        )
        assert values["ARCLOOM_GRAPH_PASSWORD"] == password


@pytest.mark.parametrize(
    "change", [{"host": "https://invalid/host"}, {"password": "private\nheader"}, {"port": 0}]
)
def test_invalid_graph_target_never_leaks_values(runtime, change):
    with TestClient(create_app(runtime.settings, runtime)) as client:
        login = client.post("/api/auth/login", json={"token": ADMIN}).json()
        response = client.post(
            "/api/graph-hosting/target",
            headers={"X-CSRF-Token": login["csrf"]},
            json=connection(**change),
        )
        assert response.status_code == 422
        assert "private" not in response.text
