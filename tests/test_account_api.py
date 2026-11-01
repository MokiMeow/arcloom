"""HTTP account contracts; graph failures use the explicit injected unit port."""

import pytest
from fastapi.testclient import TestClient

from arcloom.api import COOKIE, create_app

PASSWORD = "correct private account password"


@pytest.fixture
def account_client(runtime):
    with TestClient(create_app(runtime.settings, runtime)) as client:
        yield client


def register(client, email="first@accounts.example", password=PASSWORD):
    response = client.post(
        "/api/auth/register", json={"name": "Account owner", "email": email, "password": password}
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_signup_has_a_private_empty_workspace_and_safe_session(account_client, runtime):
    options = account_client.get("/api/auth/options").json()
    assert options["signup_enabled"] is True
    signed = register(account_client)
    assert signed["actor"]["tenant"] != runtime.settings.tenant
    assert signed["actor"]["password_account"] is True
    assert signed["actor"]["email"] == "first@accounts.example"
    assert signed["recovery_code"]
    dashboard = account_client.get("/api/dashboard").json()
    assert dashboard["workspace"] == signed["actor"]["tenant"]
    assert dashboard["counts"] == {}
    assert dashboard["findings"] == []
    assert dashboard["verified_current"] == 0
    assert dashboard["budget"]["executions"] == 0
    assert account_client.get("/api/investigations").json()["total"] == 0
    assert account_client.get("/api/audit/verify").json()["valid"] is True
    session = account_client.get("/api/auth/session").json()
    assert session == {"actor": signed["actor"], "csrf": signed["csrf"]}
    assert "recovery_code" not in session
    assert "password_hash" not in str(session)
    assert any(cookie.has_nonstandard_attr("HttpOnly") for cookie in account_client.cookies.jar)
    assert account_client.post("/api/auth/logout").status_code == 403


def test_account_login_preserves_password_spaces_and_rotates_cookie(account_client):
    password = "  correct account password  "
    signed = register(account_client, password=password)
    previous = account_client.cookies.get(COOKIE)
    assert (
        account_client.post(
            "/api/auth/logout", headers={"X-CSRF-Token": signed["csrf"]}
        ).status_code
        == 204
    )
    wrong = account_client.post(
        "/api/auth/login", json={"email": "first@accounts.example", "password": password.strip()}
    )
    assert wrong.status_code == 401
    good = account_client.post(
        "/api/auth/login", json={"email": " FIRST@ACCOUNTS.EXAMPLE ", "password": password}
    )
    assert good.status_code == 200
    assert account_client.cookies.get(COOKIE) != previous
    assert good.json()["actor"]["id"] == signed["actor"]["id"]


def test_password_change_requires_proof_and_revokes_previous_sessions(account_client):
    signed = register(account_client)
    old_cookie = account_client.cookies.get(COOKIE)
    headers = {"X-CSRF-Token": signed["csrf"]}
    change = {
        "current_password": "incorrect password",
        "new_password": "a changed private password",
    }
    wrong = account_client.post("/api/auth/password", json=change, headers=headers)
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "invalid_credentials"
    assert account_client.get("/api/dashboard").status_code == 200
    change["current_password"] = PASSWORD
    good = account_client.post("/api/auth/password", json=change, headers=headers)
    assert good.status_code == 200
    assert good.json()["csrf"] != signed["csrf"]
    assert account_client.cookies.get(COOKIE) != old_cookie
    assert account_client.get("/api/dashboard").status_code == 200
    account_client.cookies.clear()
    account_client.cookies.set(COOKIE, old_cookie, path="/api")
    assert account_client.get("/api/dashboard").status_code == 401
    assert (
        account_client.post(
            "/api/auth/login", json={"email": "first@accounts.example", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert (
        account_client.post(
            "/api/auth/login",
            json={"email": "first@accounts.example", "password": change["new_password"]},
        ).status_code
        == 200
    )


def test_recovery_is_single_use_and_does_not_leak_new_code(account_client):
    signed = register(account_client)
    original_cookie = account_client.cookies.get(COOKIE)
    payload = {
        "email": "first@accounts.example",
        "recovery_code": signed["recovery_code"],
        "new_password": "my recovered private password",
    }
    recovered = account_client.post("/api/auth/recover", json=payload)
    assert recovered.status_code == 200
    assert recovered.json()["recovery_code"] != signed["recovery_code"]
    assert account_client.cookies.get(COOKIE) != original_cookie
    assert account_client.post("/api/auth/recover", json=payload).status_code == 401
    assert "recovery_code" not in account_client.get("/api/auth/session").json()
    assert account_client.get("/api/dashboard").status_code == 200
    account_client.cookies.clear()
    account_client.cookies.set(COOKIE, original_cookie, path="/api")
    assert account_client.get("/api/dashboard").status_code == 401


def test_private_workspace_records_and_provider_credentials_are_isolated(account_client):
    first = register(account_client)
    first_cookie = account_client.cookies.get(COOKIE)
    headers = {"X-CSRF-Token": first["csrf"], "Idempotency-Key": "private-report-001"}
    report = account_client.post(
        "/api/reports",
        headers=headers,
        json={
            "title": "A real registered gateway report",
            "description": "Observed the controlled registered boundary response.",
            "researcher": "Account owner",
            "asset_id": "gateway",
            "test_id": "gateway-boundary",
        },
    )
    assert report.status_code == 201
    case_id = report.json()["case_id"]
    provider = account_client.post(
        "/api/providers",
        headers=headers,
        json={
            "provider": "openai",
            "model": "gpt-4.1-mini",
            "api_key": "private-test-provider-key",
        },
    )
    assert provider.status_code == 200, provider.text
    graph = account_client.post(
        "/api/graph-hosting/target",
        headers=headers,
        json={
            "host": "first.example.test",
            "port": 6379,
            "username": "owner",
            "password": "private-test-graph-password",
            "ssl": True,
        },
    )
    assert graph.status_code == 200
    assert "private-test-graph-password" not in graph.text
    account_client.cookies.clear()
    second = register(account_client, "second@accounts.example")
    assert second["actor"]["tenant"] != first["actor"]["tenant"]
    assert account_client.get("/api/investigations").json()["total"] == 0
    assert account_client.get(f"/api/investigations/{case_id}").status_code == 404
    dashboard = account_client.get("/api/dashboard").json()
    assert dashboard["model"]["provider"] == "deterministic"
    status = account_client.get("/api/providers")
    assert status.status_code == 200
    assert "private-test-provider-key" not in status.text
    hosting = account_client.get("/api/graph-hosting").json()
    assert hosting["target"] is None
    assert hosting["current"]["port"] is None
    assert hosting["current"]["prefix"] == ""
    account_client.cookies.clear()
    account_client.cookies.set(COOKIE, first_cookie, path="/api")
    assert account_client.get("/api/dashboard").json()["model"]["provider"] == "openai"
    assert account_client.get("/api/graph-hosting").json()["target"]["host"] == "first.example.test"


def test_graph_outage_preserves_signup_and_fails_closed(account_client, runtime):
    runtime.graph.available = False
    register(account_client)
    dashboard = account_client.get("/api/dashboard").json()
    assert dashboard["counts"] == {}
    assert dashboard["memory"]["available"] is False
    assert dashboard["memory"]["in_sync"] is False
    assert dashboard["memory"]["pending_events"] > 0
    assert account_client.get("/api/memory").status_code == 503


def test_operator_can_close_signup_without_affecting_existing_login(account_client, runtime):
    register(account_client)
    runtime.settings.signup_enabled = False
    assert account_client.get("/api/auth/options").json()["signup_enabled"] is False
    denied = account_client.post(
        "/api/auth/register",
        json={"name": "Another user", "email": "closed@accounts.example", "password": PASSWORD},
    )
    assert denied.status_code == 403
    assert (
        account_client.post(
            "/api/auth/login", json={"email": "first@accounts.example", "password": PASSWORD}
        ).status_code
        == 200
    )


def test_auth_validation_never_echoes_password_or_recovery_material(account_client):
    secrets = {
        "password": "short-secret",
        "new_password": "short-next",
        "recovery_code": "short-code",
    }
    response = account_client.post(
        "/api/auth/register",
        json={"name": "Owner", "email": "bad-address", "password": secrets["password"]},
    )
    assert response.status_code == 422
    response2 = account_client.post("/api/auth/recover", json={"email": "bad-address", **secrets})
    assert response2.status_code == 422
    assert all(value not in response.text + response2.text for value in secrets.values())
    assert (
        account_client.post(
            "/api/auth/register",
            json={"name": "Owner", "email": "owner@accounts.example", "password": PASSWORD},
            headers={"Origin": "https://untrusted.example"},
        ).status_code
        == 403
    )
