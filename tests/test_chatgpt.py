"""Subscription OAuth and streamed proposals; no real accounts or inference."""

import hashlib
import json
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from arcloom.config import Settings
from arcloom.domain import DomainError
from tests.test_models import CANDIDATE, SELECTION


def auth_class():
    from arcloom.chatgpt_auth import ChatGPTAuth

    return ChatGPTAuth


@pytest.fixture
def oauth(tmp_path):
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    jwk.update(kid="test", use="sig", alg="RS256")
    state = {
        "claims": {},
        "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
        "refreshes": 0,
        "posts": [],
    }

    def handler(request):
        if request.url.path == "/.well-known/openid-configuration":
            return httpx.Response(
                200,
                json={
                    "issuer": "https://auth.openai.com",
                    "jwks_uri": "https://auth.openai.com/.well-known/jwks.json",
                    "revocation_endpoint": "https://auth.openai.com/oauth/revoke",
                },
            )
        if request.url.path == "/.well-known/jwks.json":
            return httpx.Response(200, json={"keys": [jwk]})
        if request.url.path == "/oauth/revoke":
            state["revoked"] = parse_qs(request.content.decode())
            state["revoke_attempts"] = state.get("revoke_attempts", 0) + 1
            if state.get("revoke_network_once") and state["revoke_attempts"] == 1:
                raise httpx.ConnectError("Temporary connection failure", request=request)
            if state.get("revocation_failure"):
                return httpx.Response(503, json={"error": "temporarily_unavailable"})
            return httpx.Response(200)
        if request.url.path == "/v1/models":
            return httpx.Response(
                200,
                json={
                    "models": [
                        {
                            "slug": "test-model",
                            "display_name": "Test model",
                            "visibility": "list",
                            "base_instructions": "x" * state.get("catalog_instruction_bytes", 0),
                        },
                        {"slug": "hidden", "visibility": "hide"},
                    ]
                },
            )
        form = parse_qs(request.content.decode())
        state["posts"].append(form)
        if form["grant_type"] == ["refresh_token"]:
            state["refreshes"] += 1
            if state.get("refresh_error"):
                return httpx.Response(400, json={"error": state["refresh_error"]})
            return httpx.Response(
                200,
                json={
                    "access_token": "renewed",
                    "refresh_token": "rotated",
                    "expires_in": 3600,
                    "token_type": "Bearer",
                    "scope": state["scope"],
                },
            )
        claims = {
            "iss": "https://auth.openai.com",
            "aud": "oaiapp_test",
            "sub": "person-1",
            "iat": int(time.time()),
            "exp": int(time.time()) + 3600,
            "nonce": state["nonce"],
            "email": "person@example.test",
            **state["claims"],
        }
        token = jwt.encode(claims, private, algorithm="RS256", headers={"kid": "test"})
        if state.get("tamper"):
            token = token[:-8] + "abcdefgh"
        return httpx.Response(
            200,
            json={
                "access_token": "access-secret",
                "refresh_token": "refresh-secret",
                "id_token": token,
                "expires_in": state.get("expiry", 3600),
                "token_type": "Bearer",
                "scope": state["scope"],
            },
        )

    auth = auth_class()(Settings(_env_file=None, data_dir=tmp_path), httpx.MockTransport(handler))
    yield auth, state
    auth.close()


def begin(auth, state, profile=None):
    started = auth.start(profile)
    query = parse_qs(urlsplit(started["authorization_url"]).query)
    state["nonce"] = query["nonce"][0]
    return query


def callback(query, **values):
    params = {
        "state": query["state"][0],
        "code": "one-time-code",
        "client_id": "oaiapp_test",
        **values,
    }
    with httpx.Client(trust_env=False) as client:
        return client.get(query["redirect_uri"][0] + "?" + urlencode(params))


def test_initial_registration_and_storage(oauth):
    auth, state = oauth
    query = begin(auth, state)
    assert query["client_id"] == ["dynamic_agent_client"]
    assert query["agent_name_hint"] == ["Arcloom"]
    assert query["ext_agent_host_id"][0].startswith("urn:uuid:")
    assert callback(query).status_code == 200
    status = auth.status()
    assert status["connected"] and not status["pending"]
    assert auth.access_token() == "access-secret"
    assert "access-secret" not in json.dumps(status)
    assert auth.models() == [{"id": "test-model", "name": "Test model"}]
    assert state["posts"][0]["client_id"] == ["oaiapp_test"]
    verifier = state["posts"][0]["code_verifier"][0]
    import base64

    assert query["code_challenge"] == [
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    ]
    if __import__("os").name == "nt":
        assert b"access-secret" not in auth.credential_path.read_bytes()


def test_catalog_accepts_large_instruction_fields_but_returns_only_picker_metadata(oauth):
    auth, state = oauth
    assert callback(begin(auth, state)).status_code == 200
    state["catalog_instruction_bytes"] = 620_000
    assert auth.models() == [{"id": "test-model", "name": "Test model"}]


def test_catalog_rejects_more_than_two_mib_without_clearing_credentials(oauth):
    auth, state = oauth
    assert callback(begin(auth, state)).status_code == 200
    state["catalog_instruction_bytes"] = 2 * 1024 * 1024
    with pytest.raises(DomainError) as error:
        auth.models()
    assert error.value.code == "chatgpt_unavailable"
    assert auth.status()["connected"]


def test_identity_requests_keep_smaller_response_budget(oauth):
    auth, _state = oauth
    auth.transport = httpx.MockTransport(
        lambda _: httpx.Response(
            200, json={"issuer": "https://auth.openai.com", "padding": "x" * (128 * 1024)}
        )
    )
    with pytest.raises(ValueError, match="response budget"):
        auth._metadata()


@pytest.mark.parametrize(
    "claims",
    [
        {"nonce": "wrong"},
        {"iss": "https://evil.test"},
        {"aud": "other-client"},
        {"exp": 1},
        {"sub": ""},
    ],
)
def test_invalid_signed_identity_is_never_connected(oauth, claims):
    auth, state = oauth
    state["claims"] = claims
    assert callback(begin(auth, state)).status_code == 400
    assert not auth.status()["connected"]


def test_signature_and_state_and_duplicate_fields_rejected(oauth):
    auth, state = oauth
    query = begin(auth, state)
    assert callback(query, state="wrong").status_code == 400
    assert not state["posts"]
    auth.close()
    query = begin(auth, state)
    state["tamper"] = True
    assert callback(query).status_code == 400
    assert not auth.status()["connected"]


def test_missing_direct_scope_retains_identity_but_blocks_inference(oauth):
    auth, state = oauth
    state["scope"] = "openid profile email"
    assert callback(begin(auth, state)).status_code == 200
    assert len(auth.status()["profiles"]) == 1
    assert not auth.status()["connected"]
    with pytest.raises(DomainError) as error:
        auth.access_token()
    assert error.value.code == "chatgpt_auth_required" and error.value.status == 403


def test_refresh_serialized_and_disconnect_retains_registration(oauth):
    auth, state = oauth
    state["expiry"] = 1
    assert callback(begin(auth, state)).status_code == 200
    other = auth_class()(auth.settings, auth.transport)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(lambda instance: instance.access_token(), [auth, other])) == [
            "renewed",
            "renewed",
        ]
    assert state["refreshes"] == 1
    before = auth.status()["active_profile_id"]
    assert not auth.disconnect()["connected"]
    assert state["revoked"]["token"] == ["rotated"]
    query = begin(auth, state, before)
    assert query["client_id"] == ["oaiapp_test"]
    assert "agent_name_hint" not in query and "id_token_hint" not in query
    other.close()


def stream_event(kind, **data):
    return ("data: " + json.dumps({"type": kind, **data}) + "\n\n").encode()


def proposal(**changes):
    return {
        "status": "completed",
        "output": [
            {
                "type": "function_call",
                "namespace": "arcloom",
                "name": "propose_investigation",
                "arguments": json.dumps(SELECTION),
            }
        ],
        "usage": {"input_tokens": 23, "output_tokens": 17},
        **changes,
    }


def finalized_items():
    return [
        {"id": "rs_test", "type": "reasoning", "content": [], "summary": []},
        {"id": "fc_test", "status": "completed", "call_id": "call_test", **proposal()["output"][0]},
    ]


def finalized_events(items=None):
    items = finalized_items() if items is None else items
    events = bytearray()
    for index, item in enumerate(items):
        added = {**item}
        if item["type"] == "function_call":
            added.update(arguments="", status="in_progress")
        events.extend(stream_event("response.output_item.added", output_index=index, item=added))
        if item["type"] == "function_call":
            arguments = item["arguments"]
            events.extend(
                stream_event(
                    "response.function_call_arguments.delta",
                    output_index=index,
                    item_id=item["id"],
                    delta=arguments[:20],
                )
            )
            events.extend(
                stream_event(
                    "response.function_call_arguments.delta",
                    output_index=index,
                    item_id=item["id"],
                    delta=arguments[20:],
                )
            )
            events.extend(
                stream_event(
                    "response.function_call_arguments.done",
                    output_index=index,
                    item_id=item["id"],
                    arguments=arguments,
                )
            )
        events.extend(stream_event("response.output_item.done", output_index=index, item=item))
    return bytes(events)


@pytest.mark.parametrize("terminal_output", ["omitted", "empty", "matching"])
def test_finalized_items_supply_output_for_slim_completed_envelope(terminal_output):
    terminal = proposal(output=finalized_items() if terminal_output == "matching" else [])
    if terminal_output == "omitted":
        terminal.pop("output")
    result = planner(
        finalized_events() + stream_event("response.completed", response=terminal)
    ).select([CANDIDATE])
    assert result.selection.candidate_id == CANDIDATE.test_id
    assert (result.input_tokens, result.output_tokens) == (23, 17)


@pytest.mark.parametrize(
    "bad_kind",
    [
        "duplicate_done",
        "index_changed",
        "item_id_changed",
        "terminal_mismatch",
        "unfinalized",
        "delta_only",
        "argument_mismatch",
        "missing_completed",
        "incomplete_call",
    ],
)
def test_finalized_output_assembly_rejects_inconsistent_or_unfinished_stream(bad_kind):
    items = finalized_items()
    terminal = proposal(output=[])
    events = finalized_events(items)
    if bad_kind == "duplicate_done":
        events += stream_event("response.output_item.done", output_index=1, item=items[1])
    elif bad_kind == "index_changed":
        events += stream_event("response.output_item.done", output_index=2, item=items[1])
    elif bad_kind == "item_id_changed":
        events = stream_event(
            "response.output_item.added", output_index=0, item={**items[0], "id": "rs_other"}
        ) + stream_event("response.output_item.done", output_index=0, item=items[0])
    elif bad_kind == "terminal_mismatch":
        terminal["output"] = [
            {**items[1], "arguments": json.dumps({**SELECTION, "candidate_id": "other"})}
        ]
    elif bad_kind == "unfinalized":
        events = stream_event("response.output_item.added", output_index=0, item=items[1])
    elif bad_kind == "delta_only":
        events = stream_event(
            "response.function_call_arguments.delta",
            output_index=0,
            item_id=items[1]["id"],
            delta=items[1]["arguments"],
        )
    elif bad_kind == "argument_mismatch":
        events = stream_event(
            "response.function_call_arguments.done",
            output_index=0,
            item_id=items[1]["id"],
            arguments="{}",
        ) + stream_event("response.output_item.done", output_index=0, item=items[1])
    elif bad_kind == "incomplete_call":
        items[1]["status"] = "incomplete"
        events = finalized_events(items)
    if bad_kind != "missing_completed":
        events += stream_event("response.completed", response=terminal)
    with pytest.raises(DomainError):
        planner(events).select([CANDIDATE])


def planner(stream, requests=None, *, content_type="text/event-stream"):
    from arcloom.chatgpt_planner import ChatGPTPlanner

    class Auth:
        def status(self):
            return {"active_profile_id": "p1"}

        def access_token(self, profile_id=None):
            assert profile_id == "p1"
            return "own-subscription"

        def models(self, profile_id=None):
            assert profile_id == "p1"
            return [{"id": "test-model", "name": "Test"}]

    def handler(request):
        if requests is not None:
            requests.append(request)
        headers = {} if content_type is None else {"Content-Type": content_type}
        return httpx.Response(200, content=stream, headers=headers)

    settings = Settings(_env_file=None, model="test-model")
    return ChatGPTPlanner(settings, Auth(), httpx.MockTransport(handler))


def test_stream_requires_completed_and_uses_supported_namespace():
    requests = []
    result = planner(stream_event("response.completed", response=proposal()), requests).select(
        [CANDIDATE]
    )
    assert result.selection.candidate_id == CANDIDATE.test_id
    body = json.loads(requests[0].content)
    assert requests[0].url == "https://api.openai.com/v1/responses"
    assert requests[0].headers["Authorization"] == "Bearer own-subscription"
    assert body["stream"] is True and body["store"] is False
    assert body["tools"][0]["type"] == "namespace"
    assert "max_output_tokens" not in body
    assert (result.input_tokens, result.output_tokens) == (23, 17)


def test_missing_content_type_accepts_valid_finalized_response_stream():
    stream = finalized_events() + stream_event("response.completed", response=proposal(output=[]))
    result = planner(stream, content_type=None).select([CANDIDATE])
    assert result.selection.candidate_id == CANDIDATE.test_id


@pytest.mark.parametrize(
    "stream",
    [b"<html>Admission failed</html>", b'{"output":[]}', finalized_events()],
    ids=["html", "json", "uncompleted"],
)
def test_missing_content_type_still_rejects_non_sse_or_uncompleted_body(stream):
    with pytest.raises(DomainError):
        planner(stream, content_type=None).select([CANDIDATE])


@pytest.mark.parametrize("content_type", ["text/html", "application/json", "text/plain", ""])
def test_present_wrong_content_type_rejects_even_valid_sse(content_type):
    stream = finalized_events() + stream_event("response.completed", response=proposal(output=[]))
    with pytest.raises(DomainError):
        planner(stream, content_type=content_type).select([CANDIDATE])


@pytest.mark.parametrize(
    "stream",
    [
        b"",
        stream_event("response.output_item.done", item=proposal()["output"][0]),
        stream_event(
            "response.failed",
            response={"error": {"code": "subscription_sharing_usage_limit_exceeded"}},
        ),
        stream_event("response.incomplete", response=proposal()),
        stream_event("response.completed", response=proposal(output=[])),
        stream_event("response.completed", response=proposal(usage={"input_tokens": -1})),
        stream_event("response.completed", response=proposal(output=[proposal()["output"][0]] * 2)),
    ],
)
def test_incomplete_or_invalid_streams_fail_without_fallback(stream):
    with pytest.raises(DomainError):
        planner(stream).select([CANDIDATE])


def test_selection_outside_sent_ten_is_rejected():
    from dataclasses import replace

    candidates = [replace(CANDIDATE, test_id=f"candidate_{index}") for index in range(10)] + [
        CANDIDATE
    ]
    with pytest.raises(DomainError):
        planner(stream_event("response.completed", response=proposal())).select(candidates)


def test_revocation_failure_clears_only_tokens_and_reports_unconfirmed(oauth):
    auth, state = oauth
    callback(begin(auth, state))
    state["revocation_failure"] = True
    status = auth.disconnect()
    assert not status["connected"] and status["revocation_confirmed"] is False
    assert "not confirmed" in status["last_error"]
    assert len(status["profiles"]) == 1


def test_revocation_retries_one_transient_network_failure(oauth):
    auth, state = oauth
    callback(begin(auth, state))
    state["revoke_network_once"] = True
    assert auth.disconnect()["revocation_confirmed"] is True
    assert state["revoke_attempts"] == 2


@pytest.mark.parametrize(
    "error,cleared",
    [("invalid_grant", True), ("refresh_token_reused", True), ("temporarily_unavailable", False)],
)
def test_terminal_refresh_clears_but_transient_refresh_preserves_grant(oauth, error, cleared):
    auth, state = oauth
    state["expiry"] = 1
    callback(begin(auth, state))
    state["refresh_error"] = error
    with pytest.raises(DomainError):
        auth.access_token()
    assert auth.status()["connected"] is not cleared


def test_reauthorization_rejects_changed_subject_without_replacing_saved_grant(oauth):
    auth, state = oauth
    callback(begin(auth, state))
    profile = auth.status()["active_profile_id"]
    query = begin(auth, state, profile)
    assert "id_token_hint" in query
    state["claims"] = {"sub": "someone-else"}
    assert callback(query).status_code == 400
    assert auth.access_token(profile) == "access-secret"


def test_host_and_duplicate_query_cannot_redeem_code(oauth):
    auth, state = oauth
    query = begin(auth, state)
    target = "/auth/callback?" + urlencode(
        {"state": query["state"][0], "code": "private-code", "client_id": "oaiapp_test"}
    )
    assert not auth._callback(target, "evil.test")
    assert not auth._callback(target + "&code=duplicate", urlsplit(query["redirect_uri"][0]).netloc)
    assert not state["posts"]


def test_close_cancels_inflight_callback_before_credentials_are_saved(oauth):
    import threading

    auth, state = oauth
    query = begin(auth, state)
    entered, release = threading.Event(), threading.Event()
    original = auth._identity

    def wait_identity(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    auth._identity = wait_identity
    target = "/auth/callback?" + urlencode(
        {"state": query["state"][0], "code": "private-code", "client_id": "oaiapp_test"}
    )
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(auth._callback, target, urlsplit(query["redirect_uri"][0]).netloc)
        assert entered.wait(2)
        assert auth.status()["pending"] is True
        auth.close()
        release.set()
        assert task.result() is False
    assert not auth.status()["connected"]


def test_processing_callback_remains_pending_and_cannot_be_replayed(oauth):
    import threading

    auth, state = oauth
    query = begin(auth, state)
    entered, release = threading.Event(), threading.Event()
    original = auth._identity

    def wait_identity(*args, **kwargs):
        entered.set()
        assert release.wait(5)
        return original(*args, **kwargs)

    auth._identity = wait_identity
    target = "/auth/callback?" + urlencode(
        {"state": query["state"][0], "code": "private-code", "client_id": "oaiapp_test"}
    )
    host = urlsplit(query["redirect_uri"][0]).netloc
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(auth._callback, target, host)
        assert entered.wait(2)
        try:
            assert auth.status()["pending"] is True
            assert not auth._callback(target, host)
            assert auth.status()["pending"] is True
            assert len(state["posts"]) == 1
        finally:
            release.set()
        assert task.result() is True
    assert auth.status()["connected"] and not auth.status()["pending"]


def test_usage_limit_failure_keeps_machine_code():
    stream = stream_event(
        "response.failed", response={"error": {"code": "subscription_sharing_usage_limit_exceeded"}}
    )
    with pytest.raises(DomainError) as error:
        planner(stream).select([CANDIDATE])
    assert error.value.code == "subscription_sharing_usage_limit_exceeded"
    assert error.value.status == 429
    assert error.value.upstream_status == 200
    assert error.value.upstream_code == "subscription_sharing_usage_limit_exceeded"


@pytest.mark.parametrize(
    "tail",
    [
        stream_event(
            "response.failed",
            response={"error": {"code": "subscription_sharing_usage_unavailable"}},
        ),
        stream_event("response.completed", response=proposal()),
        b"data: {bad-json}\n\n",
        b"x" * (256 * 1024),
    ],
    ids=["failure", "duplicate", "json", "oversized"],
)
def test_trailing_failure_duplicate_terminal_or_oversized_stream_is_rejected(tail):
    with pytest.raises(DomainError):
        planner(stream_event("response.completed", response=proposal()) + tail).select([CANDIDATE])


def test_multiple_registrations_same_email_stay_separate(oauth):
    auth, state = oauth
    first_query = begin(auth, state)
    assert callback(first_query).status_code == 200
    first = auth.status()["active_profile_id"]
    state["claims"] = {"aud": "oaiapp_second", "sub": "person-2"}
    second_query = begin(auth, state)
    assert callback(second_query, client_id="oaiapp_second").status_code == 200
    status = auth.status()
    assert len(status["profiles"]) == 2
    assert len({p["email"] for p in status["profiles"]}) == 1
    assert len({p["label"] for p in status["profiles"]}) == 2
    assert first_query["ext_agent_host_id"] == second_query["ext_agent_host_id"]
    auth.activate(first)
    assert auth.status()["active_profile_id"] == first
    assert auth.access_token(first) == "access-secret"


@pytest.mark.parametrize(
    "changes",
    [
        {"namespace": "shell"},
        {"name": "run_command"},
        {"status": "incomplete"},
        {"arguments": json.dumps({**SELECTION, "evidence_ids": ["finding_one", "finding_one"]})},
    ],
)
def test_only_completed_authorized_proposal_is_accepted(changes):
    value = proposal()
    value["output"][0].update(changes)
    with pytest.raises(DomainError):
        planner(stream_event("response.completed", response=value)).select([CANDIDATE])


def test_network_chunks_and_crlf_event_boundaries_are_supported():
    from arcloom.chatgpt_planner import ChatGPTPlanner

    class Chunks(httpx.SyncByteStream):
        def __iter__(self):
            raw = stream_event("response.completed", response=proposal()).replace(b"\n", b"\r\n")
            for start in range(0, len(raw), 7):
                yield raw[start : start + 7]

    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=Chunks()))
        ) as client,
        client.stream("GET", "https://example.test") as response,
    ):
        result = ChatGPTPlanner._consume(response, time.monotonic() + 5)
    assert result["status"] == "completed"


def test_stream_deadline_rejects_valid_but_late_terminal_event(monkeypatch):
    from arcloom import chatgpt_planner

    calls = iter([1, 99])
    monkeypatch.setattr(chatgpt_planner.time, "monotonic", lambda: next(calls))
    with pytest.raises(DomainError):
        planner(stream_event("response.completed", response=proposal())).select([CANDIDATE])


def test_shared_budget_prevents_upstream_call_after_deadline(oauth):
    auth, state = oauth
    callback(begin(auth, state))
    with auth.request_budget(time.monotonic() - 1), pytest.raises(DomainError):
        auth.models()


def test_authentication_time_counts_toward_planner_deadline(monkeypatch):
    from arcloom import chatgpt_planner

    instance = planner(stream_event("response.completed", response=proposal()))
    clock = {"now": 1}
    catalog_called = []
    monkeypatch.setattr(chatgpt_planner.time, "monotonic", lambda: clock["now"])

    def slow_access(_profile):
        clock["now"] = 100
        return "token"

    instance.auth.access_token = slow_access
    instance.auth.models = lambda _profile: catalog_called.append(True)
    with pytest.raises(DomainError):
        instance.select([CANDIDATE])
    assert not catalog_called
