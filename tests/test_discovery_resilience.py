import pytest

from arcloom.agents import DeterministicPlanner
from arcloom.domain import DiscoveryInput, DomainError, Role
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


@pytest.mark.parametrize("lease", ["missing", "expired"])
def test_interrupted_planning_replay_records_failure_without_another_paid_call(
    runtime, owner, lease
):
    confirm(runtime, owner)
    runtime.settings.provider = "openai"
    calls = []

    class Interrupted:
        def select(self, _):
            calls.append("called")
            raise SystemExit("Simulate process interruption outside ordinary error handling")

    runtime.discovery.planner_factory = Interrupted
    with pytest.raises(SystemExit):
        runtime.discovery.run(owner, DiscoveryInput(), "interrupted-planning-one")
    assert runtime.store.one("SELECT status FROM agent_sessions")["status"] == "planning"
    if lease == "expired":
        with runtime.store.transaction() as conn:
            conn.execute(
                "INSERT INTO locks VALUES(?,?,0)",
                ("discovery_" + owner.tenant, "interrupted-owner"),
            )

    replay = runtime.discovery.run(owner, DiscoveryInput(), "interrupted-planning-one")

    assert replay["status"] == "failed" and replay["error"] == "discovery_interrupted"
    assert replay["case_id"] is None
    assert runtime.discovery.run(owner, DiscoveryInput(), "interrupted-planning-one") == replay
    assert runtime.store.one("SELECT status FROM agent_sessions")["status"] == "failed"
    assert runtime.dashboard(owner)["budget"]["model_calls"] == 1
    assert calls == ["called"]


def test_active_planning_replay_remains_pending(runtime, owner):
    confirm(runtime, owner)
    key = "active-planning-one"
    replies = []

    class Pending:
        def select(self, candidates):
            replies.append(runtime.discovery.run(owner, DiscoveryInput(), key))
            return DeterministicPlanner().select(candidates)

    runtime.discovery.planner_factory = Pending
    result = runtime.discovery.run(owner, DiscoveryInput(), key)
    assert replies[0]["status"] == "planning"
    assert result["status"] == "proposed"


@pytest.mark.parametrize("same_actor", [True, False])
def test_new_discovery_reconciles_older_interrupted_session(runtime, owner, same_actor):
    confirm(runtime, owner)

    class Interrupted:
        def select(self, _):
            raise SystemExit("Interrupted planning")

    runtime.discovery.planner_factory = Interrupted
    with pytest.raises(SystemExit):
        runtime.discovery.run(owner, DiscoveryInput(), "old-planning-request")
    old_agent = runtime.store.one("SELECT id FROM agent_sessions")["id"]
    runtime.discovery.planner_factory = DeterministicPlanner
    reviewer = owner
    if not same_actor:
        member = runtime.auth.add_member(owner, "Another reviewer", Role.REVIEWER)
        reviewer = runtime.auth.bearer(member["token"])

    result = runtime.discovery.run(reviewer, DiscoveryInput(), "new-planning-request")

    assert result["status"] == "proposed"
    assert (
        runtime.store.one("SELECT status FROM agent_sessions WHERE id=?", (old_agent,))["status"]
        == "failed"
    )
    assert (
        runtime.discovery.run(owner, DiscoveryInput(), "old-planning-request")["error"]
        == "discovery_interrupted"
    )


@pytest.mark.parametrize("replay", [True, False])
def test_interrupted_recovery_preserves_original_provider_metadata(runtime, owner, replay):
    confirm(runtime, owner)
    runtime.settings.provider = "openai"
    runtime.settings.model = "original-model"

    class Interrupted:
        def select(self, _):
            raise SystemExit("Interrupted planning")

    runtime.discovery.planner_factory = Interrupted
    with pytest.raises(SystemExit):
        runtime.discovery.run(owner, DiscoveryInput(), "original-provider-request")
    old_agent = runtime.store.one("SELECT id FROM agent_sessions")["id"]
    runtime.settings.provider = "deterministic"
    runtime.settings.model = ""
    runtime.discovery.planner_factory = DeterministicPlanner

    runtime.discovery.run(
        owner, DiscoveryInput(), "original-provider-request" if replay else "new-provider-request"
    )
    runtime.projector.require_current(owner.tenant)

    projected = runtime.graph.nodes[owner.tenant][old_agent]["props"]
    assert projected["provider"] == "openai"
    assert projected["model"] == "original-model"


@pytest.mark.parametrize("lease", ["ownership", "expiry"])
def test_planner_that_lost_its_lease_cannot_commit_a_proposal(runtime, owner, lease):
    confirm(runtime, owner)
    before = len(runtime.store.all("SELECT * FROM cases"))

    class Stale:
        def select(self, candidates):
            with runtime.store.transaction() as conn:
                if lease == "ownership":
                    conn.execute(
                        "UPDATE locks SET owner='replacement-owner' WHERE name=?",
                        ("discovery_" + owner.tenant,),
                    )
                else:
                    conn.execute(
                        "UPDATE locks SET expires_at=0 WHERE name=?", ("discovery_" + owner.tenant,)
                    )
            return DeterministicPlanner().select(candidates)

    runtime.discovery.planner_factory = Stale
    with pytest.raises(DomainError) as error:
        runtime.discovery.run(owner, DiscoveryInput(), "stale-planning-one")
    assert error.value.code == "discovery_interrupted"
    assert len(runtime.store.all("SELECT * FROM cases")) == before
    assert runtime.store.one("SELECT status FROM agent_sessions")["status"] == "failed"
