import json
import subprocess
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from arcloom.api import create_app
from arcloom.domain import DomainError, Role
from tests.conftest import ADMIN


def test_provider_profiles_persist_and_never_expose_keys(runtime, owner):
    assert hasattr(runtime, "providers"), "Runtime must compose provider management"
    manager = runtime.providers
    manager.configure(owner, provider="openai", model="gpt-test", api_key="private-openai")
    before = manager.snapshot()
    manager.configure(owner, provider="gemini", model="gemini-test", api_key="private-gemini")
    manager.configure(owner, provider="openai", model="gpt-other", api_key="")
    assert before.provider == "openai" and before.model == "gpt-test"
    assert manager.snapshot().model_api_key.get_secret_value() == "private-openai"
    public = manager.status()
    assert public["active_provider"] == "openai"
    assert "private-" not in json.dumps(public)
    assert "private-" not in json.dumps(runtime.store.all("SELECT * FROM events"))
    from arcloom.providers import ProviderManager

    restored = ProviderManager(runtime.settings, runtime.store)
    assert restored.snapshot().provider == "openai"
    assert restored.snapshot().model_api_key.get_secret_value() == "private-openai"


def test_provider_switch_does_not_borrow_credentials(runtime, owner):
    assert hasattr(runtime, "providers"), "Runtime must compose provider management"
    runtime.providers.configure(
        owner, provider="openai", model="gpt-test", api_key="private-openai"
    )
    with pytest.raises(DomainError, match="API key"):
        runtime.providers.configure(owner, provider="gemini", model="gemini-test")
    assert runtime.providers.snapshot().provider == "openai"


def test_provider_endpoints_require_admin_and_csrf(runtime, owner):
    with TestClient(create_app(runtime.settings, runtime)) as client:
        assert client.get("/api/providers").status_code == 401
        login = client.post("/api/auth/login", json={"token": ADMIN}).json()
        assert client.get("/api/providers").status_code == 200
        assert (
            client.post(
                "/api/providers", json={"provider": "deterministic", "model": ""}
            ).status_code
            == 403
        )
        headers = {"X-CSRF-Token": login["csrf"]}
        assert (
            client.post(
                "/api/providers", headers=headers, json={"provider": "deterministic", "model": ""}
            ).status_code
            == 200
        )
        member = runtime.auth.add_member(owner, "Read only", Role.VIEWER)
        client.cookies.clear()
        client.headers["Authorization"] = "Bearer " + member["token"]
        assert client.get("/api/providers").status_code == 403
        assert client.post("/api/providers/test").status_code == 403


def test_diagnostic_creates_no_findings_and_accounts_failures(runtime, owner):
    assert hasattr(runtime, "providers"), "Runtime must compose provider management"
    manager = runtime.providers
    result = manager.test(owner)
    assert result["status"] == "selected" and result["diagnostic"]
    assert runtime.store.one("SELECT count(*) AS n FROM findings")["n"] == 0
    assert runtime.store.one("SELECT count(*) AS n FROM agent_sessions")["n"] == 0
    manager.configure(owner, provider="openai", model="gpt-test", api_key="private-openai")

    class Failing:
        def select(self, candidates):
            raise RuntimeError("private-openai upstream body")

    manager.planner_factory = lambda settings: Failing()
    result = manager.test(owner)
    assert result["status"] == "error"
    assert "private-openai" not in json.dumps(result)
    assert runtime.store.one("SELECT model_calls FROM budgets")["model_calls"] == 1
    runtime.settings.model_call_budget = 1
    with pytest.raises(DomainError, match="budget"):
        manager.test(owner)
    assert "private-openai" not in json.dumps(runtime.store.all("SELECT * FROM events"))


def test_provider_changes_do_not_misattribute_inflight_discovery(runtime, owner):
    assert hasattr(runtime, "providers"), "Runtime must compose provider management"
    from arcloom.agents import DeterministicPlanner
    from arcloom.domain import DiscoveryInput
    from tests.helpers import confirm

    confirm(runtime, owner)
    manager = runtime.providers
    manager.configure(owner, provider="openai", model="first-model", api_key="private-openai")
    captured = []

    class Changing:
        def __init__(self, settings):
            captured.append(settings)

        def select(self, candidates):
            manager.configure(
                owner, provider="gemini", model="second-model", api_key="private-gemini"
            )
            assert captured[0].model_api_key.get_secret_value() == "private-openai"
            return DeterministicPlanner().select(candidates)

    manager.planner_factory = Changing
    result = runtime.discovery.run(owner, DiscoveryInput(), "snapshot-provider-001")
    assert result["provider"] == "openai"
    session = runtime.store.one("SELECT * FROM agent_sessions WHERE id=?", (result["agent_id"],))
    assert session["provider"] == "openai" and session["model"] == "first-model"
    assert runtime.dashboard(owner)["model"]["provider"] == "gemini"
    assert runtime.store.one("SELECT model_calls FROM budgets")["model_calls"] == 1


def test_provider_status_never_triggers_inference(runtime, owner):
    assert hasattr(runtime, "providers"), "Runtime must compose provider management"
    runtime.providers.configure(
        owner, provider="openai", model="test-model", api_key="private-openai"
    )

    def forbidden(settings):
        raise AssertionError("GET must not construct an inference planner")

    runtime.providers.planner_factory = forbidden
    with TestClient(create_app(runtime.settings, runtime)) as client:
        response = client.get("/api/providers", headers={"Authorization": "Bearer " + ADMIN})
        assert response.status_code == 200
        assert "private-openai" not in response.text
    assert runtime.store.one("SELECT model_calls FROM budgets")["model_calls"] == 0


def test_chatgpt_can_be_selected_before_model_but_cannot_infer(runtime, owner):
    assert hasattr(runtime, "providers"), "Runtime must compose provider management"
    runtime.providers.configure(owner, provider="chatgpt", model="")
    assert runtime.providers.snapshot().provider == "chatgpt"
    with pytest.raises(DomainError, match="Connect a ChatGPT"):
        runtime.providers.test(owner)
    assert runtime.store.one("SELECT model_calls FROM budgets")["model_calls"] == 0


def test_provider_config_cli_lists_status(monkeypatch, capsys, runtime):
    import sys

    from arcloom.cli import main

    monkeypatch.setattr(sys, "argv", ["arcloom", "providers"])
    monkeypatch.setattr("arcloom.runtime.Runtime", lambda _: runtime)
    monkeypatch.setattr("arcloom.config.Settings", lambda: runtime.settings)
    main()
    assert json.loads(capsys.readouterr().out)["active_provider"] == "deterministic"


def test_chatgpt_model_catalog_uses_explicit_selected_profile(runtime, monkeypatch):
    seen = []

    def models(profile_id=None):
        seen.append(profile_id)
        return [{"id": "account-model", "name": "Account model"}]

    monkeypatch.setattr(runtime.chatgpt, "models", models)
    with TestClient(create_app(runtime.settings, runtime)) as client:
        response = client.get(
            "/api/providers/chatgpt/models?profile_id=other_account",
            headers={"Authorization": "Bearer " + ADMIN},
        )
        assert response.status_code == 200
        assert response.json()["items"][0]["id"] == "account-model"
    assert seen == ["other_account"]


def test_environment_provider_credentials_refresh_without_copying_secret(runtime, owner):
    from pydantic import SecretStr

    from arcloom.providers import ProviderManager

    original = runtime.settings.model_copy(
        update={
            "provider": "cloudflare",
            "model": "clef",
            "cloudflare_account_id": "a" * 32,
            "model_api_key": SecretStr("old-environment-key"),
        }
    )
    manager = ProviderManager(original, runtime.store)
    manager.configure(owner, provider="gemini", model="gemini-test", api_key="saved-gemini-key")
    persisted = manager.path.read_text()
    assert "old-environment-key" not in persisted
    assert json.loads(persisted)["profiles"]["cloudflare"]["credential_source"] == "environment"
    refreshed = original.model_copy(
        update={
            "model_api_key": SecretStr("new-environment-key"),
            "cloudflare_account_id": "b" * 32,
        }
    )
    restored = ProviderManager(refreshed, runtime.store)
    restored.configure(owner, provider="cloudflare", model="clef", api_key="")
    assert restored.snapshot().model_api_key.get_secret_value() == "new-environment-key"
    assert restored.snapshot().cloudflare_account_id == "b" * 32
    assert "new-environment-key" not in restored.path.read_text()


def test_saved_provider_credentials_win_environment_refresh(runtime, owner):
    from pydantic import SecretStr

    from arcloom.providers import ProviderManager

    original = runtime.settings.model_copy(
        update={
            "provider": "cloudflare",
            "model": "clef",
            "cloudflare_account_id": "a" * 32,
            "model_api_key": SecretStr("old-environment-key"),
        }
    )
    manager = ProviderManager(original, runtime.store)
    manager.configure(
        owner,
        provider="cloudflare",
        model="clef",
        api_key="saved-cloudflare-key",
        account_id="c" * 32,
    )
    refreshed = original.model_copy(
        update={
            "model_api_key": SecretStr("new-environment-key"),
            "cloudflare_account_id": "b" * 32,
        }
    )
    restored = ProviderManager(refreshed, runtime.store)
    restored.configure(owner, provider="cloudflare", model="clef", api_key="")
    assert restored.snapshot().model_api_key.get_secret_value() == "saved-cloudflare-key"
    assert restored.snapshot().cloudflare_account_id == "c" * 32


@pytest.mark.parametrize(
    "key", ["secret\r\nInjected: header", "secret\x00key", "secret\tkey", "secret\x7fkey"]
)
def test_provider_rejects_header_control_characters_without_echo(runtime, key):
    with TestClient(create_app(runtime.settings, runtime)) as client:
        response = client.post(
            "/api/providers",
            json={"provider": "openai", "model": "test-model", "api_key": key},
            headers={"Authorization": "Bearer " + ADMIN},
        )
        assert response.status_code == 422
        assert "secret" not in response.text
    assert not runtime.providers.path.exists()


def test_status_reports_configured_chatgpt_account_when_oauth_active_differs(
    runtime, owner, monkeypatch
):
    auth_status = {
        "connected": True,
        "active_profile_id": "account_b",
        "profiles": [
            {"id": "account_a", "email": "a@example.test", "label": "A", "connected": False},
            {"id": "account_b", "email": "b@example.test", "label": "B", "connected": True},
        ],
        "pending": False,
    }
    monkeypatch.setattr(runtime.chatgpt, "activate", lambda _: auth_status)
    monkeypatch.setattr(runtime.chatgpt, "status", lambda: auth_status)
    runtime.providers.configure(
        owner, provider="chatgpt", model="account-model", profile_id="account_a"
    )
    state = runtime.providers.status()
    provider = next(item for item in state["providers"] if item["id"] == "chatgpt")
    assert provider["profile_id"] == "account_a"
    assert provider["connected"] is False
    assert state["chatgpt"]["active_profile_id"] == "account_b"
    assert runtime.providers.snapshot().chatgpt_profile_id == "account_a"


def test_environment_profile_never_borrows_other_environment_provider_key(runtime, owner):
    from pydantic import SecretStr

    from arcloom.providers import ProviderManager

    original = runtime.settings.model_copy(
        update={
            "provider": "cloudflare",
            "model": "clef",
            "cloudflare_account_id": "a" * 32,
            "model_api_key": SecretStr("cloudflare-environment-key"),
        }
    )
    manager = ProviderManager(original, runtime.store)
    manager.configure(owner, provider="gemini", model="gemini-test", api_key="saved-gemini-key")
    changed_environment = runtime.settings.model_copy(
        update={
            "provider": "openai",
            "model": "openai-model",
            "model_api_key": SecretStr("openai-environment-key"),
        }
    )
    restored = ProviderManager(changed_environment, runtime.store)
    with pytest.raises(DomainError, match="API key"):
        restored.configure(owner, provider="cloudflare", model="clef", api_key="")
    assert restored.snapshot().provider == "gemini"


@pytest.fixture
def wrangler_manager(runtime, monkeypatch):
    from pydantic import SecretStr

    from arcloom.providers import ProviderManager

    monkeypatch.delenv("CLOUDFLARE_API_TOKEN", raising=False)
    monkeypatch.delenv("ARCLOOM_MODEL_API_KEY", raising=False)
    original = runtime.settings.model_copy(
        update={
            "provider": "cloudflare",
            "model": "clef-flash",
            "cloudflare_account_id": "a" * 32,
            "model_api_key": SecretStr("expired-copy"),
            "cloudflare_wrangler_until": int(time.time()) + 86400,
        }
    )
    return ProviderManager(original, runtime.store, runtime.chatgpt)


def test_planning_refreshes_environment_wrangler_key_and_preserves_captured_settings(
    wrangler_manager, monkeypatch
):
    manager = wrangler_manager
    calls = []

    def run(args, **kwargs):
        calls.append(kwargs)
        return SimpleNamespace(
            returncode=0,
            stdout=json.dumps({"type": "oauth", "token": f"private-fresh-{len(calls)}"}),
            stderr="private-upstream-output",
        )

    monkeypatch.setattr(subprocess, "run", run)
    snapshot = manager.snapshot()
    manager.status()
    assert calls == []
    settings, planner = manager.planning_snapshot(snapshot)
    assert settings.model_api_key.get_secret_value() == "private-fresh-1"
    assert planner.settings is settings
    assert snapshot.model_api_key.get_secret_value() == "expired-copy"
    assert manager.settings.model_api_key.get_secret_value() == "expired-copy"
    again, _ = manager.planning_snapshot()
    assert again.model_api_key.get_secret_value() == "private-fresh-2"
    assert settings.model_api_key.get_secret_value() == "private-fresh-1"
    assert all(0 < item["timeout"] <= 20 for item in calls)
    assert not manager.path.exists()


@pytest.mark.parametrize(
    "case", ["saved", "expired", "absent", "other-owner", "chatgpt", "process-key"]
)
def test_wrangler_is_not_invoked_for_other_credential_owners(
    wrangler_manager, owner, monkeypatch, case
):
    from pydantic import SecretStr

    manager = wrangler_manager
    if case == "saved":
        manager.configure(owner, provider="cloudflare", model="clef", api_key="saved-ui-key")
    elif case == "expired":
        manager.settings.cloudflare_wrangler_until = int(time.time()) - 1
    elif case == "absent":
        manager.settings.cloudflare_wrangler_until = None
    elif case == "other-owner":
        manager.settings.provider = "gemini"
        manager.settings.model = "gemini-test"
        manager.settings.model_api_key = SecretStr("gemini-environment-key")
    elif case == "chatgpt":
        manager.configure(owner, provider="chatgpt", model="luna", profile_id=None)
        monkeypatch.setattr(
            manager.chatgpt,
            "status",
            lambda: {"connected": True, "active_profile_id": "existing-profile", "profiles": []},
        )
    elif case == "process-key":
        monkeypatch.setenv("ARCLOOM_MODEL_API_KEY", "process-key-wins")
        manager.settings.model_api_key = SecretStr("process-key-wins")

    def forbidden(*args, **kwargs):
        pytest.fail("This credential owner must not invoke Wrangler")

    monkeypatch.setattr(subprocess, "run", forbidden)
    manager.planner_factory = lambda settings: SimpleNamespace(settings=settings)
    settings, _ = manager.planning_snapshot()
    if case == "saved":
        assert settings.model_api_key.get_secret_value() == "saved-ui-key"
    elif case == "process-key":
        assert settings.model_api_key.get_secret_value() == "process-key-wins"


def test_planning_refresh_failure_is_sanitized_without_cause_chain(wrangler_manager, monkeypatch):
    def fail(*args, **kwargs):
        raise subprocess.TimeoutExpired("private-CLI-secret", 1, output="private-output")

    monkeypatch.setattr(subprocess, "run", fail)
    with pytest.raises(DomainError) as error:
        wrangler_manager.planning_snapshot()
    assert error.value.code == "cloudflare_credentials"
    assert "private-" not in str(error.value)
    assert error.value.__cause__ is None
    assert error.value.__context__ is None


def test_planning_refresh_counts_against_total_model_timeout(wrangler_manager, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("arcloom.providers.time.monotonic", lambda: clock[0])

    def run(*args, **kwargs):
        assert kwargs["timeout"] <= 20
        clock[0] += 3
        return SimpleNamespace(returncode=0, stdout='{"type":"oauth","token":"fresh"}')

    monkeypatch.setattr(subprocess, "run", run)
    settings, planner = wrangler_manager.planning_snapshot()
    assert settings.model_timeout_seconds == 17
    assert settings._model_deadline == 120
    assert planner.settings.model_timeout_seconds == 17
    assert wrangler_manager.settings.model_timeout_seconds == 20


@pytest.mark.parametrize(
    "deadline", ["bad", True, -1, 0, float("inf"), int(time.time()) + 5 * 86400]
)
def test_invalid_or_unbounded_wrangler_deadline_is_rejected(deadline):
    from pydantic import ValidationError

    from arcloom.config import Settings

    with pytest.raises(ValidationError):
        Settings(_env_file=None, cloudflare_wrangler_until=deadline)


def test_provider_diagnostic_uses_fresh_wrangler_credentials(wrangler_manager, owner, monkeypatch):
    from arcloom.agents import DeterministicPlanner

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0, stdout='{"type":"oauth","token":"diagnostic-fresh"}'
        ),
    )
    captured = []

    def factory(settings):
        captured.append(settings.model_api_key.get_secret_value())
        return DeterministicPlanner()

    wrangler_manager.planner_factory = factory
    assert wrangler_manager.test(owner)["status"] == "selected"
    assert captured == ["diagnostic-fresh"]


def test_slow_wrangler_cannot_add_inference_after_total_timeout(wrangler_manager, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr("arcloom.providers.time.monotonic", lambda: clock[0])

    def run(*args, **kwargs):
        clock[0] += 21
        return SimpleNamespace(returncode=0, stdout='{"type":"oauth","token":"fresh"}')

    monkeypatch.setattr(subprocess, "run", run)

    def forbidden(settings):
        pytest.fail("An exhausted planning deadline must not construct an inference planner")

    wrangler_manager.planner_factory = forbidden
    with pytest.raises(DomainError) as error:
        wrangler_manager.planning_snapshot()
    assert error.value.code == "model_timeout"


def test_process_cloudflare_token_takes_precedence_without_cli(wrangler_manager, monkeypatch):
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "explicit-cloudflare-token")

    def forbidden(*args, **kwargs):
        pytest.fail("An explicit process token must not invoke Wrangler")

    monkeypatch.setattr(subprocess, "run", forbidden)
    settings, planner = wrangler_manager.planning_snapshot()
    assert settings.model_api_key.get_secret_value() == "explicit-cloudflare-token"
    assert planner.settings is settings


def test_runtime_discovery_refreshes_only_the_actual_cloudflare_planner(
    runtime, wrangler_manager, owner, monkeypatch
):
    from arcloom.agents import DeterministicPlanner
    from arcloom.domain import DiscoveryInput
    from tests.helpers import confirm

    confirm(runtime, owner)
    runtime.providers = wrangler_manager
    captured = []

    def factory(settings):
        captured.append(settings.model_api_key.get_secret_value())
        return DeterministicPlanner()

    wrangler_manager.planner_factory = factory
    runtime.discovery.settings_factory = wrangler_manager.snapshot
    runtime.discovery.snapshot_planner_factory = wrangler_manager.planner
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0, stdout='{"type":"oauth","token":"runtime-fresh"}'
        ),
    )
    result = runtime.discovery.run(owner, DiscoveryInput(), "wrangler-runtime-001")
    assert result["provider"] == "cloudflare"
    assert captured == ["runtime-fresh"]
