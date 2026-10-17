import pytest

from arcloom.agents import DeterministicPlanner
from arcloom.domain import DiscoveryInput, DomainError
from arcloom.storage import new_id
from tests.helpers import confirm


def test_fresh_planner_constructed_for_each_context(runtime, owner):
    confirm(runtime, owner)
    creations = []

    def factory():
        creations.append(object())
        return DeterministicPlanner()

    runtime.discovery.planner_factory = factory
    a = runtime.discovery.run(owner, DiscoveryInput(), "fresh-context-001")
    b = runtime.discovery.run(owner, DiscoveryInput(), "fresh-context-002")
    assert a["agent_id"] != b["agent_id"]
    assert len(creations) == 2
    assert a["tool"]["previous_messages"] == b["tool"]["previous_messages"] == 0


def test_discovery_idempotency_does_not_call_planner_twice(runtime, owner):
    confirm(runtime, owner)
    a = runtime.discovery.run(owner, DiscoveryInput(), "unique-step-id-001")
    b = runtime.discovery.run(owner, DiscoveryInput(), "unique-step-id-001")
    assert a == b
    assert len(runtime.store.all("SELECT * FROM agent_sessions")) == 1


def test_failed_model_call_consumes_budget_without_finding(runtime, owner):
    confirm(runtime, owner)
    runtime.settings.provider = "openai"
    runtime.settings.model = "test-stub"

    class Failing:
        def select(self, _):
            raise DomainError("model_unavailable", "Injected provider outage", 502)

    runtime.discovery.planner_factory = Failing
    with pytest.raises(DomainError):
        runtime.discovery.run(owner, DiscoveryInput(), "failed-provider-001")
    assert runtime.dashboard(owner)["budget"]["model_calls"] == 1
    assert runtime.dashboard(owner)["verified_current"] == 1
    assert runtime.store.one("SELECT status FROM agent_sessions")["status"] == "failed"
    # Reusing the request key returns its recorded failure, never another paid call.
    repeated = runtime.discovery.run(owner, DiscoveryInput(), "failed-provider-001")
    assert repeated["status"] == "failed"
    assert runtime.dashboard(owner)["budget"]["model_calls"] == 1


def test_model_budget_admission_blocks_call(runtime, owner):
    confirm(runtime, owner)
    runtime.settings.provider = "openai"
    with runtime.store.transaction() as c:
        c.execute("UPDATE budgets SET model_calls=200")
    with pytest.raises(DomainError) as err:
        runtime.discovery.run(owner, DiscoveryInput(), new_id("request"))
    assert err.value.code == "model_budget"
    assert runtime.store.all("SELECT * FROM agent_sessions") == []


def test_depth_budget_stops_expanding(runtime, owner):
    confirm(runtime, owner)
    confirm(runtime, owner, "invoice-tenant-boundary")
    runtime.settings.max_depth = 1
    # Seeded reports have depth zero, so their graph-derived follow-up depth is one.
    step = runtime.discovery.run(owner, DiscoveryInput(), new_id("request"))
    assert step["selection"]["depth"] == 1


def test_competing_discovery_lease_prevents_parallel_calls(runtime, owner):
    confirm(runtime, owner)
    assert runtime.store.acquire_lock("discovery_" + owner.tenant, "other-owner", 90)
    with pytest.raises(DomainError) as err:
        runtime.discovery.run(owner, DiscoveryInput(), new_id("request"))
    assert err.value.code == "discovery_busy"
    assert runtime.store.all("SELECT * FROM agent_sessions") == []
