"""Provider contracts are mocked; no paid inference is claimed by these tests."""

import json
from copy import deepcopy
from dataclasses import replace

import httpx
import pytest
from pydantic import ValidationError

from arcloom.clef import ClefPlanner, probability, token_count
from arcloom.config import Settings
from arcloom.domain import DiscoveryInput, DomainError
from tests.helpers import confirm
from tests.test_models import CANDIDATE


def config(model="clef"):
    return Settings(
        _env_file=None,
        provider="cloudflare",
        model=model,
        model_api_key="test-cloudflare-only",
        cloudflare_account_id="a" * 32,
    )


def payload(model="clef"):
    return {
        "success": True,
        "errors": [],
        "result": {
            "model": model,
            "answers": {
                "next_test": {
                    "type": "choice",
                    "choice": CANDIDATE.test_id,
                    "probabilities": {CANDIDATE.test_id: 0.9, "abstain": 0.1},
                    "confidence": 0.85,
                },
                "caution": {"type": "noul", "noul": 0.1},
            },
            "usage": {"input_tokens": 250, "output_tokens": 0},
        },
    }


@pytest.mark.parametrize("name", ["clef", "clef-flash", "clef-omni"])
@pytest.mark.parametrize("prefix", ["", "@cf/cloudflare/"])
def test_all_model_variants_have_bounded_native_protocol(name, prefix):
    calls = []

    def handler(req):
        calls.append(req)
        assert req.url.host == "api.cloudflare.com"
        assert req.url.path.endswith("/ai/run/@cf/cloudflare/" + name)
        body = json.loads(req.content)
        assert body["model"] == name
        assert body["state"]["previous_conversation"] == []
        assert "messages" not in body and "tools" not in body
        assert set(body["questions"]["next_test"]["criteria"]) == {CANDIDATE.test_id, "abstain"}
        assert "test-cloudflare-only" not in req.content.decode()
        return httpx.Response(200, json=payload(name))

    result = ClefPlanner(config(prefix + name), httpx.MockTransport(handler)).select([CANDIDATE])
    assert result.selection.candidate_id == CANDIDATE.test_id
    assert result.selection.evidence_ids == list(CANDIDATE.finding_ids)
    assert result.decision["calibrated_on_arcloom"] is False
    assert result.decision["estimated_model_cost_usd"] > 0
    assert len(result.decision["input_sha256"]) == 64 and len(calls) == 1


@pytest.mark.parametrize("why", ["abstain", "confidence", "margin", "caution"])
def test_uncertainty_is_not_a_successful_proposal(why):
    data = payload()
    answer = data["result"]["answers"]["next_test"]
    if why == "abstain":
        answer.update(choice="abstain", probabilities={CANDIDATE.test_id: 0.1, "abstain": 0.9})
    elif why == "confidence":
        answer["confidence"] = 0.2
    elif why == "margin":
        answer["probabilities"] = {CANDIDATE.test_id: 0.52, "abstain": 0.48}
    else:
        data["result"]["answers"]["caution"]["noul"] = 0.9
    result = ClefPlanner(
        config(), httpx.MockTransport(lambda _: httpx.Response(200, json=data))
    ).select([CANDIDATE])
    assert result.selection is None and result.decision["outcome"] == "needs_review"
    assert result.input_tokens == 250


@pytest.mark.parametrize(
    "where,value",
    [
        ("choice", "unknown"),
        ("confidence", True),
        ("probabilities", {}),
        ("probabilities", {CANDIDATE.test_id: 0.9, "abstain": 0.8}),
        ("probabilities", {CANDIDATE.test_id: 0.1, "abstain": 0.9}),
        ("type", "free_text"),
    ],
)
def test_invalid_decision_fails_closed(where, value):
    data = payload()
    data["result"]["answers"]["next_test"][where] = value
    with pytest.raises(DomainError) as exc:
        ClefPlanner(config(), httpx.MockTransport(lambda _: httpx.Response(200, json=data))).select(
            [CANDIDATE]
        )
    assert exc.value.code == "model_unavailable"


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_provider_failure_does_not_fall_back(status):
    with pytest.raises(DomainError):
        ClefPlanner(
            config(), httpx.MockTransport(lambda _: httpx.Response(status, json={}))
        ).select([CANDIDATE])


@pytest.mark.parametrize("bad", [None, "0.9", True, float("nan"), float("inf"), -1, 2])
def test_probability_contract(bad):
    with pytest.raises(ValueError):
        probability(bad)


@pytest.mark.parametrize("bad", [None, "10", True, 1.2, -1, 10000001])
def test_usage_contract(bad):
    with pytest.raises(ValueError):
        token_count(bad)


def test_empty_or_oversize_context_never_calls_network():
    def handler(_):
        raise AssertionError("No network call expected")

    planner = ClefPlanner(config(), httpx.MockTransport(handler))
    for values in [[], [replace(CANDIDATE, title="x" * 24000)]]:
        with pytest.raises(DomainError):
            planner.select(values)


@pytest.mark.parametrize("account", ["", "../other", "a" * 31, "G" * 32])
def test_account_path_is_not_user_controlled(account):
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            provider="cloudflare",
            model="clef",
            model_api_key="test",
            cloudflare_account_id=account,
        )


def test_abstention_is_persisted_and_charged_once(runtime, owner):
    confirm(runtime, owner)
    runtime.settings.provider = "cloudflare"
    runtime.settings.model = "clef"
    data = payload()
    data["result"]["answers"]["caution"]["noul"] = 0.9

    def handler(req):
        value = deepcopy(data)
        ids = json.loads(req.content)["questions"]["next_test"]["criteria"]
        value["result"]["answers"]["next_test"]["probabilities"] = {
            k: (0.9 if k == CANDIDATE.test_id else 0.1 / (len(ids) - 1)) for k in ids
        }
        return httpx.Response(200, json=value)

    runtime.discovery.planner_factory = lambda: ClefPlanner(config(), httpx.MockTransport(handler))
    before = len(runtime.store.all("SELECT * FROM cases"))
    result = runtime.discovery.run(owner, DiscoveryInput(), "clef-abstention-one")
    assert result["status"] == "needs_review" and result["case_id"] is None
    assert runtime.discovery.run(owner, DiscoveryInput(), "clef-abstention-one") == result
    assert len(runtime.store.all("SELECT * FROM cases")) == before
    assert runtime.dashboard(owner)["budget"]["model_calls"] == 1
    runtime.projector.require_current(owner.tenant)
    stored = runtime.graph.nodes[owner.tenant][result["agent_id"]]
    assert stored["props"]["decision"]["outcome"] == "needs_review"
    assert runtime.store.verify_audit(owner.tenant)["valid"]
