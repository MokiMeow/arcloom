"""Native Gemini contracts use mocked HTTP; they do not claim live inference."""

import json
from copy import deepcopy
from dataclasses import replace

import httpx
import pytest
from pydantic import ValidationError

from arcloom.agents import ModelPlanner
from arcloom.config import Settings
from arcloom.domain import DomainError
from tests.test_models import CANDIDATE, SELECTION, response, settings


@pytest.mark.parametrize("model", ["gemini-3.8-flash", "gemini-3.5-flash-lite"])
def test_current_gemini_ids_are_configurable(model):
    assert (
        Settings(_env_file=None, provider="gemini", model=model, model_api_key="test").model
        == model
    )


@pytest.mark.parametrize(
    "model",
    [
        "../other",
        "models/gemini-3.8-flash",
        "gemini?key=leak",
        "gemini#fragment",
        "gemini:method",
        "gemini%2fother",
        "gemini\\other",
        " gemini",
        "g" * 129,
        "gémíni",
    ],
)
def test_gemini_model_cannot_change_request_path(model):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, provider="gemini", model=model, model_api_key="test")


@pytest.mark.parametrize("missing", ["model", "model_api_key"])
def test_gemini_requires_explicit_model_and_key(missing):
    values = {"model": "gemini-3.5-flash-lite", "model_api_key": "test"}
    values[missing] = ""
    with pytest.raises(ValidationError):
        Settings(_env_file=None, provider="gemini", **values)


@pytest.mark.parametrize(
    "bad",
    [
        {**SELECTION, "candidate_id": "unregistered-shell"},
        {**SELECTION, "evidence_ids": ["finding_fake"]},
        {**SELECTION, "evidence_ids": ["finding_one", "finding_fake"]},
        {**SELECTION, "command": "unregistered command"},
        {**SELECTION, "reason": "ok"},
    ],
)
def test_gemini_rejects_unsupported_selection(bad):
    planner = ModelPlanner(
        settings("gemini"),
        httpx.MockTransport(lambda _: httpx.Response(200, json=response("gemini", bad))),
    )
    with pytest.raises(DomainError) as error:
        planner.select([CANDIDATE])
    assert error.value.code in {"model_unavailable", "invalid_model_selection"}


@pytest.mark.parametrize(
    "malformed",
    [
        "no_candidates",
        "two_candidates",
        "null_candidate",
        "null_content",
        "null_parts",
        "null_part",
        "no_call",
        "null_call",
        "wrong_name",
        "two_calls",
        "null_args",
        "string_args",
        "truncated",
        "blocked",
    ],
)
def test_gemini_rejects_invalid_response_envelope(malformed):
    data = response("gemini")
    candidate = data["candidates"][0]
    parts = candidate["content"]["parts"]
    if malformed == "no_candidates":
        data["candidates"] = []
    elif malformed == "two_candidates":
        data["candidates"].append(deepcopy(candidate))
    elif malformed == "null_candidate":
        data["candidates"] = [None]
    elif malformed == "null_content":
        candidate["content"] = None
    elif malformed == "null_parts":
        candidate["content"]["parts"] = None
    elif malformed == "null_part":
        parts.append(None)
    elif malformed == "no_call":
        candidate["content"]["parts"] = [{"text": "I cannot select a tool"}]
    elif malformed == "null_call":
        parts[0]["functionCall"] = None
    elif malformed == "wrong_name":
        parts[0]["functionCall"]["name"] = "execute_test"
    elif malformed == "two_calls":
        parts.append(deepcopy(parts[0]))
    elif malformed == "null_args":
        parts[0]["functionCall"]["args"] = None
    elif malformed == "string_args":
        parts[0]["functionCall"]["args"] = json.dumps(SELECTION)
    elif malformed == "truncated":
        candidate["finishReason"] = "MAX_TOKENS"
    else:
        data["promptFeedback"] = {"blockReason": "SAFETY"}
    planner = ModelPlanner(
        settings("gemini"), httpx.MockTransport(lambda _: httpx.Response(200, json=data))
    )
    with pytest.raises(DomainError) as error:
        planner.select([CANDIDATE])
    assert error.value.code == "model_unavailable"


@pytest.mark.parametrize(
    "field", ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"]
)
@pytest.mark.parametrize("bad", [None, True, "10", 1.5, -1, 10_000_001])
def test_gemini_rejects_malformed_usage(field, bad):
    data = response("gemini")
    data["usageMetadata"][field] = bad
    planner = ModelPlanner(
        settings("gemini"), httpx.MockTransport(lambda _: httpx.Response(200, json=data))
    )
    with pytest.raises(DomainError) as error:
        planner.select([CANDIDATE])
    assert error.value.code == "model_unavailable"


def test_gemini_counts_thoughts_as_output():
    data = response("gemini")
    data["usageMetadata"].update(thoughtsTokenCount=20, totalTokenCount=335)
    result = ModelPlanner(
        settings("gemini"), httpx.MockTransport(lambda _: httpx.Response(200, json=data))
    ).select([CANDIDATE])
    assert (result.input_tokens, result.output_tokens) == (250, 85)


@pytest.mark.parametrize("usage", [None, [], "usage"])
def test_gemini_rejects_malformed_usage_object(usage):
    data = response("gemini")
    data["usageMetadata"] = usage
    with pytest.raises(DomainError):
        ModelPlanner(
            settings("gemini"), httpx.MockTransport(lambda _: httpx.Response(200, json=data))
        ).select([CANDIDATE])


@pytest.mark.parametrize("status", [302, 401, 403, 429, 500, 503])
def test_gemini_provider_failure_has_no_retry_or_fallback(status):
    calls = []

    def handler(req):
        calls.append(req)
        return httpx.Response(
            status,
            json={"error": "private provider details"},
            headers={"location": "https://outside.invalid"},
        )

    with pytest.raises(DomainError) as error:
        ModelPlanner(settings("gemini"), httpx.MockTransport(handler)).select([CANDIDATE])
    assert error.value.code == "model_unavailable"
    assert "private provider details" not in str(error.value)
    assert len(calls) == 1


def test_gemini_timeout_is_consumed_once():
    calls = []

    def handler(req):
        calls.append(req)
        assert req.extensions["timeout"]["read"] == 20
        raise httpx.ReadTimeout("private provider details")

    with pytest.raises(DomainError) as error:
        ModelPlanner(settings("gemini"), httpx.MockTransport(handler)).select([CANDIDATE])
    assert error.value.code == "model_unavailable" and len(calls) == 1


def test_gemini_bounded_context_never_calls_network():
    def handler(_):
        raise AssertionError("Unexpected network call")

    planner = ModelPlanner(settings("gemini"), httpx.MockTransport(handler))
    for candidates, code in [
        ([], "no_candidates"),
        ([replace(CANDIDATE, title="x" * 25_000)], "context_budget"),
    ]:
        with pytest.raises(DomainError) as error:
            planner.select(candidates)
        assert error.value.code == code


def test_gemini_bounds_response_bytes():
    with pytest.raises(DomainError) as error:
        ModelPlanner(
            settings("gemini"),
            httpx.MockTransport(lambda _: httpx.Response(200, content=b"x" * (128 * 1024 + 1))),
        ).select([CANDIDATE])
    assert error.value.code == "model_size"


def test_selection_must_be_from_candidates_actually_transmitted():
    candidates = [replace(CANDIDATE, test_id=f"candidate-{i}") for i in range(11)]
    data = response("gemini", {**SELECTION, "candidate_id": "candidate-10"})

    def handler(req):
        context = json.loads(json.loads(req.content)["contents"][0]["parts"][0]["text"])
        assert len(context["candidates"]) == 10
        return httpx.Response(200, json=data)

    with pytest.raises(DomainError) as error:
        ModelPlanner(settings("gemini"), httpx.MockTransport(handler)).select(candidates)
    assert error.value.code == "invalid_model_selection"


def test_runtime_reports_gemini_as_live_llm(runtime, owner):
    runtime.settings.provider = "gemini"
    runtime.settings.model = "gemini-3.5-flash-lite"
    model = runtime.dashboard(owner)["model"]
    assert model["live_llm"] is True
    assert model["remote_model"] is True
    assert model["decision_model"] is False
