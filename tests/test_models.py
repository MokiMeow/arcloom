import json
from dataclasses import replace

import httpx
import pytest

from arcloom.agents import TOOL_NAME, DeterministicPlanner, ModelPlanner
from arcloom.config import Settings
from arcloom.domain import Candidate, DomainError

CANDIDATE = Candidate(
    "invoice-tenant-boundary",
    "invoice-api",
    "Check invoice boundary",
    ("internal-route-access",),
    ("finding_one",),
    70,
    1,
    ({"source": "finding_one", "relation": "ENABLES", "target": "internal-route-access"},),
)
SELECTION = {
    "candidate_id": CANDIDATE.test_id,
    "reason": "This graph path supports a test, not a confirmed finding.",
    "evidence_ids": ["finding_one"],
}


def settings(provider):
    return Settings(
        _env_file=None,
        provider=provider,
        model="test-model-not-a-production-recommendation",
        model_api_key="test-provider-key",
    )


def response(provider, selection=None):
    s = SELECTION if selection is None else selection
    if provider == "gemini":
        return {
            "candidates": [
                {
                    "content": {
                        "role": "model",
                        "parts": [{"functionCall": {"name": TOOL_NAME, "args": s}}],
                    },
                    "finishReason": "STOP",
                    "index": 0,
                }
            ],
            "usageMetadata": {
                "promptTokenCount": 250,
                "candidatesTokenCount": 65,
                "totalTokenCount": 315,
            },
            "modelVersion": "gemini-3.5-flash-lite",
        }
    return (
        {
            "output": [{"type": "function_call", "name": TOOL_NAME, "arguments": json.dumps(s)}],
            "usage": {"input_tokens": 250, "output_tokens": 65},
        }
        if provider == "openai"
        else {
            "content": [{"type": "tool_use", "name": TOOL_NAME, "input": s}],
            "usage": {"input_tokens": 250, "output_tokens": 65},
        }
    )


@pytest.mark.parametrize("provider", ["openai", "anthropic", "gemini"])
def test_live_model_adapter_contract_with_stub(provider):
    seen = []

    def handler(req):
        seen.append(req)
        body = json.loads(req.content)
        if provider == "openai":
            assert req.url.host == "api.openai.com"
            assert body["store"] is False and body["parallel_tool_calls"] is False
            schema = body["tools"][0]["parameters"]
            context = json.loads(body["input"][0]["content"])
        elif provider == "anthropic":
            assert req.url.host == "api.anthropic.com"
            assert body["tool_choice"]["disable_parallel_tool_use"]
            schema = body["tools"][0]["input_schema"]
            context = json.loads(body["messages"][0]["content"])
        else:
            assert req.url.host == "generativelanguage.googleapis.com"
            assert (
                req.url.path
                == "/v1beta/models/test-model-not-a-production-recommendation:generateContent"
            )
            assert req.headers["x-goog-api-key"] == "test-provider-key"
            assert not req.url.query
            assert body["generationConfig"] == {"maxOutputTokens": 700, "candidateCount": 1}
            assert body["toolConfig"]["functionCallingConfig"] == {
                "mode": "ANY",
                "allowedFunctionNames": [TOOL_NAME],
            }
            assert body["systemInstruction"]["parts"][0]["text"]
            assert set(body) == {
                "systemInstruction",
                "contents",
                "generationConfig",
                "tools",
                "toolConfig",
            }
            tool = body["tools"][0]["functionDeclarations"][0]
            schema = tool["parametersJsonSchema"]
            assert tool["name"] == TOOL_NAME
            assert len(body["tools"][0]["functionDeclarations"]) == 1
            context = json.loads(body["contents"][0]["parts"][0]["text"])
        assert schema["additionalProperties"] is False
        assert set(schema["required"]) == {"candidate_id", "reason", "evidence_ids"}
        assert context["previous_conversation"] == []
        if provider != "gemini":
            assert body["tools"][0]["name"] == TOOL_NAME
        assert len(body["tools"]) == 1
        return httpx.Response(200, json=response(provider))

    p = ModelPlanner(settings(provider), httpx.MockTransport(handler))
    result = p.select([CANDIDATE])
    assert result.selection.candidate_id == CANDIDATE.test_id
    assert result.input_tokens == 250 and result.output_tokens == 65
    assert len(seen) == 1


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize(
    "bad",
    [
        {
            "candidate_id": "unregistered-shell",
            "reason": "Execute something not in the graph.",
            "evidence_ids": ["finding_one"],
        },
        {
            "candidate_id": CANDIDATE.test_id,
            "reason": "I invented a source finding.",
            "evidence_ids": ["finding_fake"],
        },
        {**SELECTION, "command": "UNREGISTERED COMMAND"},
        {**SELECTION, "url": "https://outside.invalid"},
        {**SELECTION, "reason": "ok"},
    ],
)
def test_invalid_model_output_never_reaches_execution(provider, bad):
    p = ModelPlanner(
        settings(provider),
        httpx.MockTransport(lambda _: httpx.Response(200, json=response(provider, bad))),
    )
    with pytest.raises(DomainError) as err:
        p.select([CANDIDATE])
    assert err.value.code in {"invalid_model_selection", "model_unavailable"}


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("status", [401, 429, 500, 503])
def test_model_errors_never_silently_fall_back(provider, status):
    p = ModelPlanner(
        settings(provider),
        httpx.MockTransport(
            lambda _: httpx.Response(status, json={"message": "internal provider response"})
        ),
    )
    with pytest.raises(DomainError) as err:
        p.select([CANDIDATE])
    assert err.value.code == "model_unavailable"
    assert "internal provider response" not in str(err.value)


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_model_timeout_consumed_once(provider):
    calls = []

    def handler(req):
        calls.append(req)
        raise httpx.ReadTimeout("injected timeout")

    p = ModelPlanner(settings(provider), httpx.MockTransport(handler))
    with pytest.raises(DomainError):
        p.select([CANDIDATE])
    assert len(calls) == 1


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_multiple_tool_calls_rejected(provider):
    data = response(provider)
    key = "output" if provider == "openai" else "content"
    data[key] *= 2
    with pytest.raises(DomainError):
        ModelPlanner(
            settings(provider), httpx.MockTransport(lambda _: httpx.Response(200, json=data))
        ).select([CANDIDATE])


def test_empty_candidates_never_call_provider():
    def handler(_):
        raise AssertionError("No network call should occur")

    with pytest.raises(DomainError):
        ModelPlanner(settings("openai"), httpx.MockTransport(handler)).select([])


def test_context_budget_blocks_large_graph_context():
    too_large = replace(CANDIDATE, title="x" * 25000)
    with pytest.raises(DomainError) as err:
        ModelPlanner(settings("openai")).select([too_large])
    assert err.value.code == "context_budget"


def test_deterministic_mode_has_zero_model_tokens():
    result = DeterministicPlanner().select([CANDIDATE])
    assert result.input_tokens == result.output_tokens == 0
    assert "hypothesis" in result.selection.reason


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
@pytest.mark.parametrize("malformed", ["null_item", "null_usage", "invalid_usage"])
def test_malformed_provider_envelope_is_a_controlled_failure(provider, malformed):
    data = response(provider)
    if malformed == "null_item":
        data["output" if provider == "openai" else "content"] = [None]
    elif malformed == "null_usage":
        data["usage"] = None
    else:
        data["usage"] = {"input_tokens": float("inf")}
    planner = ModelPlanner(
        settings(provider),
        httpx.MockTransport(lambda _: httpx.Response(200, content=json.dumps(data))),
    )
    with pytest.raises(DomainError) as error:
        planner.select([CANDIDATE])
    assert error.value.code == "model_unavailable"
