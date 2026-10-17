import pytest
from fastapi.testclient import TestClient

from arcloom.api import create_app
from tests.conftest import ADMIN


@pytest.fixture
def client(runtime):
    with TestClient(create_app(runtime.settings, runtime)) as c:
        yield c


def test_authentication_and_csrf(client):
    assert client.get("/api/dashboard").status_code == 401
    response = client.post("/api/auth/login", json={"token": ADMIN})
    assert response.status_code == 200, response.text
    csrf = response.json()["csrf"]
    assert "HttpOnly" in response.headers["set-cookie"]
    assert client.get("/api/dashboard").status_code == 200
    assert client.get("/api/auth/session").json()["csrf"] == csrf
    assert client.post("/api/auth/logout").status_code == 403
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf}).status_code == 204
    assert client.get("/api/dashboard").status_code == 401


def test_api_workflow(client, runtime):
    client.headers["Authorization"] = "Bearer " + ADMIN
    client.headers["Idempotency-Key"] = "api-test-0000001"
    response = client.post(
        "/api/reports",
        json={
            "title": "Synthetic gateway boundary",
            "description": "Controlled lab report; gateway boundary comparison.",
            "researcher": "Test researcher",
            "asset_id": "gateway",
            "test_id": "gateway-boundary",
        },
    )
    assert response.status_code == 201, response.text
    cid = response.json()["case_id"]
    assert client.get("/api/investigations").json()["total"] == 1
    assert client.get("/api/investigations/" + cid).json()["state"] == "awaiting_approval"
    response = client.post(
        f"/api/investigations/{cid}/approve",
        json={"decision": "approve", "reason": "Approved synthetic experiment."},
    )
    assert response.status_code == 200, response.text
    runtime.worker.tick()
    response = client.post(
        f"/api/investigations/{cid}/review",
        json={"decision": "accept", "reason": "Examined all signed assertions."},
    )
    assert response.status_code == 200, response.text
    assert response.json()["finding_id"]
    response = client.post("/api/agents/discover", json={})
    assert response.status_code == 200, response.text
    assert response.json()["selection"]["test_id"] == "invoice-tenant-boundary"
    assert client.get("/api/memory").status_code == 200
    assert client.get("/api/audit/verify").json()["valid"]
    case = client.get(f"/api/investigations/{cid}").json()
    artifact = case["runs"][0]["evidence_hash"]
    assert client.get("/api/evidence/" + artifact).json()["integrity"] == "verified"
    assert client.get(f"/api/investigations/{cid}/export").status_code == 200


def test_request_security_headers(client):
    response = client.get("/health/live")
    for header in [
        "x-request-id",
        "x-content-type-options",
        "content-security-policy",
        "referrer-policy",
    ]:
        assert header in response.headers
    assert client.get("/health/live", headers={"Host": "evil.example"}).status_code == 400


def test_oversized_and_cross_origin(client):
    assert client.post("/api/auth/login", content=b"x" * 65537).status_code == 413
    assert (
        client.post(
            "/api/auth/login", json={"token": ADMIN}, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )


def test_validation_does_not_echo_token(client):
    response = client.post("/api/auth/login", json={"token": "secret-short"})
    assert response.status_code == 422
    assert "secret-short" not in response.text


def test_no_cors_wildcard(client):
    response = client.get("/api/auth/session", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in response.headers
