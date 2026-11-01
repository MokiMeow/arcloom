import time

import pytest
from pydantic import SecretStr

from arcloom.domain import Actor, DomainError, Role
from arcloom.graph import seed_graph
from arcloom.graph_hosting import GraphTargetInput, hosting_status, save_target
from arcloom.storage import digest


def private_actor(runtime, tenant="private-account"):
    actor = Actor("owner_" + tenant, tenant, Role.ADMIN)
    with runtime.store.transaction() as conn:
        conn.execute(
            "INSERT INTO tenants(id,revision,scope_enabled,created_at) VALUES(?,?,1,?)",
            (tenant, "r1", time.time()),
        )
        conn.execute("INSERT INTO budgets(tenant,revision) VALUES(?,?)", (tenant, "r1"))
        conn.execute(
            "INSERT INTO members(id,tenant,name,role,token_hash,active,created_at) VALUES(?,?,?,?,?,1,?)",
            (
                actor.id,
                tenant,
                "Private owner",
                "admin",
                digest("unused-private-token-" + tenant),
                time.time(),
            ),
        )
        runtime.store.event(
            conn,
            tenant,
            "workspace.initialized",
            "system",
            tenant,
            {"synthetic": True},
            seed_graph(),
        )
    return actor


def test_new_tenant_services_do_not_inherit_bootstrap_provider_or_account(runtime, owner):
    runtime.providers.configure(
        owner, provider="openai", model="bootstrap-model", api_key="bootstrap-private-key"
    )
    runtime.settings.model_api_key = SecretStr("inherited-environment-key")
    runtime.settings.cloudflare_account_id = "a" * 32
    runtime.settings.chatgpt_profile_id = "bootstrap-profile"
    actor = private_actor(runtime)
    settings = runtime.settings_for(actor)
    assert settings.provider == "deterministic"
    assert settings.model == ""
    assert settings.model_api_key.get_secret_value() == ""
    assert settings.admin_token.get_secret_value() == ""
    assert settings.cloudflare_account_id == ""
    assert settings.chatgpt_profile_id == ""
    assert settings.cloudflare_wrangler_until is None
    assert settings.graph_password == runtime.settings.graph_password
    assert settings.graph_host == runtime.settings.graph_host
    assert settings.graph_prefix == runtime.settings.graph_prefix
    assert settings.data_dir != runtime.settings.data_dir
    assert runtime.providers_for(actor) is runtime.providers_for(actor)
    assert runtime.providers_for(actor) is not runtime.providers
    assert runtime.chatgpt_for(actor) is not runtime.chatgpt
    assert runtime.discovery_for(actor) is not runtime.discovery
    assert runtime.dashboard(actor)["model"]["provider"] == "deterministic"
    assert not runtime.providers_for(actor).status()["chatgpt"]["profiles"]
    with pytest.raises(DomainError, match="another workspace"):
        runtime.providers.configure(actor, provider="deterministic", model="")


def test_private_workspace_provider_changes_cannot_change_another_workspace(runtime, owner):
    first, second = private_actor(runtime, "first"), private_actor(runtime, "second")
    manager = runtime.providers_for(first)
    manager.configure(first, provider="gemini", model="gemini-test", api_key="first-tenant-key")
    assert manager.snapshot().model_api_key.get_secret_value() == "first-tenant-key"
    assert runtime.providers_for(second).snapshot().provider == "deterministic"
    assert runtime.providers.snapshot().provider == "deterministic"
    assert runtime.dashboard(first)["model"]["provider"] == "gemini"
    assert runtime.dashboard(second)["model"]["provider"] == "deterministic"
    assert b"first-tenant-key" not in manager.path.read_bytes()
    with pytest.raises(DomainError, match="another workspace"):
        manager.configure(second, provider="deterministic", model="")
    with pytest.raises(DomainError, match="another workspace"):
        manager.test(second)
    assert runtime.providers_for(owner) is runtime.providers


def test_private_graph_staging_redacts_infrastructure_and_stays_isolated(runtime):
    runtime.settings.graph_host = "private-bootstrap-host.example"
    runtime.settings.graph_username = "private-bootstrap-username"
    actor = private_actor(runtime)
    settings = runtime.settings_for(actor)
    status = hosting_status(settings)
    assert status["current"]["host"] == "Managed workspace graph"
    assert status["current"]["port"] is None
    assert status["current"]["username"] == ""
    assert status["current"]["prefix"] == ""
    save_target(
        settings,
        GraphTargetInput(
            host="user-graph.example",
            port=6380,
            username="user",
            password="private-user-password",
            ssl=True,
        ),
    )
    assert hosting_status(settings)["staged"]
    assert not hosting_status(runtime.settings)["staged"]
    assert settings.data_dir != runtime.settings.data_dir


def test_unknown_workspace_cannot_allocate_tenant_services(runtime):
    with pytest.raises(DomainError, match="unavailable"):
        runtime.settings_for(Actor("unknown", "unknown-workspace", Role.ADMIN))
    assert not runtime._tenant_services
