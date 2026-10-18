"""Bounded SSE Responses planner using the user's explicit ChatGPT OAuth grant."""

import json
import re
import time
from contextlib import nullcontext

import httpx
from pydantic import ValidationError

from arcloom.agents import SYSTEM, TOOL_DESCRIPTION, TOOL_NAME, PlanResult, check_selection
from arcloom.domain import DomainError, Selection
from arcloom.storage import canonical

NAMESPACE = "arcloom"


class _FinalizedOutput:
    """Reconcile SSE item identities without promoting partial argument deltas."""

    def __init__(self):
        self.identities = {}
        self.indices = {}
        self.added = {}
        self.done = {}
        self.argument_deltas = {}
        self.arguments_done = {}

    def _bind(self, index, identifier):
        if (
            type(index) is not int
            or not 0 <= index < 32
            or not isinstance(identifier, str)
            or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", identifier)
        ):
            raise ValueError("Invalid output item identity")
        if (index in self.identities and self.identities[index] != identifier) or (
            identifier in self.indices and self.indices[identifier] != index
        ):
            raise ValueError("Output item identity changed")
        self.identities[index] = identifier
        self.indices[identifier] = index
        return index

    def observe(self, kind, event):
        if kind in {"response.output_item.added", "response.output_item.done"}:
            item = event.get("item")
            if not isinstance(item, dict) or not isinstance(item.get("type"), str):
                raise ValueError("Invalid streamed output item")
            index = self._bind(event.get("output_index"), item.get("id"))
            if index in self.done:
                raise ValueError("Duplicate finalized output item")
            if kind == "response.output_item.added":
                if index in self.added:
                    raise ValueError("Duplicate added output item")
                self.added[index] = item
                return
            prior = self.added.get(index, {})
            if any(
                key in prior and prior[key] != item.get(key)
                for key in ("type", "name", "namespace", "call_id")
            ):
                raise ValueError("Output item metadata changed")
            if item.get("status", "completed") != "completed":
                raise ValueError("Unfinished output item")
            if item["type"] == "function_call":
                arguments = item.get("arguments")
                if not isinstance(arguments, str) or len(arguments.encode()) > 12000:
                    raise ValueError("Invalid finalized arguments")
                if index in self.argument_deltas and self.argument_deltas[index] != arguments:
                    raise ValueError("Argument deltas differ from finalized item")
                if index in self.arguments_done and self.arguments_done[index] != arguments:
                    raise ValueError("Finalized arguments disagree")
            elif index in self.argument_deltas or index in self.arguments_done:
                raise ValueError("Arguments associated with a non-function item")
            self.done[index] = item
        elif kind in {
            "response.function_call_arguments.delta",
            "response.function_call_arguments.done",
        }:
            index = self._bind(event.get("output_index"), event.get("item_id"))
            if index in self.done or index in self.arguments_done:
                raise ValueError("Arguments changed after finalization")
            if kind.endswith(".delta"):
                delta = event.get("delta")
                if not isinstance(delta, str):
                    raise ValueError("Invalid argument delta")
                arguments = self.argument_deltas.get(index, "") + delta
                if len(arguments.encode()) > 12000:
                    raise ValueError("Streamed arguments exceeded budget")
                self.argument_deltas[index] = arguments
            else:
                arguments = event.get("arguments")
                if not isinstance(arguments, str) or len(arguments.encode()) > 12000:
                    raise ValueError("Invalid completed arguments")
                if index in self.argument_deltas and self.argument_deltas[index] != arguments:
                    raise ValueError("Argument deltas did not complete consistently")
                self.arguments_done[index] = arguments

    def finish(self, completed):
        if self.identities:
            if set(self.identities) != set(self.done) or set(self.done) != set(
                range(len(self.done))
            ):
                raise ValueError("Not every streamed output item was finalized")
            finalized = [self.done[index] for index in range(len(self.done))]
            # This route can emit a slim terminal envelope with output=[]. The
            # finalized item events remain authoritative only after completed.
            if (
                "output" in completed
                and completed["output"] != []
                and completed["output"] != finalized
            ):
                raise ValueError("Terminal output disagrees with finalized items")
            return {**completed, "output": finalized}
        return completed


def _upstream_error(value, status=None, request_id=None):
    """Keep known recovery codes, without trusting upstream text or leaking credentials."""
    error = value.get("error", {}) if isinstance(value, dict) else {}
    code = error.get("code") if isinstance(error, dict) else None
    messages = {
        "subscription_sharing_usage_limit_exceeded": (
            429,
            "ChatGPT plan usage limit reached. Review ChatGPT Settings → Usage before trying again.",
        ),
        "subscription_sharing_usage_unavailable": (
            503,
            "ChatGPT usage availability could not be checked. Try again later.",
        ),
        "subscription_sharing_user_unavailable": (
            503,
            "ChatGPT account availability could not be checked. Try again later.",
        ),
        "subscription_sharing_user_not_eligible": (
            403,
            "ChatGPT plan usage is unavailable for the selected account or workspace.",
        ),
        "subscription_sharing_unsupported_capability": (
            502,
            "ChatGPT rejected an unsupported inference capability.",
        ),
        "subscription_sharing_route_not_supported": (
            502,
            "ChatGPT plan usage is unavailable on this inference route.",
        ),
        "subscription_sharing_invalid_user": (
            403,
            "The selected ChatGPT account could not be validated. Reconnect if the app was disconnected.",
        ),
        "chatpass_v2_scope_not_authorized": (
            403,
            "The ChatGPT grant does not permit this operation. Review the selected account and permissions.",
        ),
        "chatpass_v2_invalid_authorization_context": (
            403,
            "The ChatGPT grant could not be validated. Review the selected account and permissions.",
        ),
    }
    if code in messages:
        public_status, message = messages[code]
        result = DomainError(code, message, public_status)
    elif status == 401:
        result = DomainError(
            "chatgpt_auth_required",
            "The selected ChatGPT account or permission was not accepted. Review the connection.",
            403,
        )
    elif status == 403:
        result = DomainError(
            "chatgpt_permission_denied",
            "ChatGPT policy or permissions prevented this request.",
            403,
        )
    else:
        result = DomainError(
            "chatgpt_unavailable", "ChatGPT inference failed. No fallback was used.", 502
        )
    # Safe diagnostic fields retain admission shape/status for local troubleshooting.
    result.upstream_status = status
    result.upstream_code = (
        code if isinstance(code, str) and re.fullmatch(r"[A-Za-z0-9._-]{1,128}", code) else None
    )
    parameter = error.get("param") if isinstance(error, dict) else None
    result.upstream_param = (
        parameter
        if isinstance(parameter, str) and re.fullmatch(r"[A-Za-z0-9._\[\]-]{1,200}", parameter)
        else None
    )
    result.upstream_shape = (
        "error"
        if isinstance(value, dict) and "error" in value
        else "detail"
        if isinstance(value, dict) and "detail" in value
        else "other"
    )
    result.upstream_request_id = (
        request_id
        if isinstance(request_id, str)
        and len(request_id) < 200
        and request_id.isascii()
        and all(c.isalnum() or c in "_-" for c in request_id)
        else None
    )
    return result


class ChatGPTPlanner:
    def __init__(self, settings, auth, transport: httpx.BaseTransport | None = None):
        self.settings, self.auth, self.transport = settings, auth, transport

    def select(self, candidates):
        deadline = time.monotonic() + self.settings.model_timeout_seconds
        if not candidates:
            raise DomainError("no_candidates", "No eligible candidates remain", 409)
        candidates = candidates[:10]
        data = canonical(
            {
                "candidates": [candidate.public() for candidate in candidates],
                "previous_conversation": [],
            }
        )
        if len(data.encode()) > 24000:
            raise DomainError(
                "context_budget", "Graph context exceeded the bounded model input budget", 409
            )
        profile_id = (
            getattr(self.settings, "chatgpt_profile_id", "")
            or self.auth.status()["active_profile_id"]
        )
        if not profile_id:
            raise DomainError(
                "chatgpt_auth_required", "Continue with ChatGPT before making a request", 403
            )
        budget = getattr(self.auth, "request_budget", None)
        with budget(deadline) if budget else nullcontext():
            token = self.auth.access_token(profile_id)
            self._remaining(deadline)
            catalog = self.auth.models(profile_id)
        self._remaining(deadline)
        if self.settings.model not in {model["id"] for model in catalog}:
            raise DomainError(
                "chatgpt_model_unavailable",
                "Choose a model available to the selected ChatGPT account",
                409,
            )
        body = {
            "model": self.settings.model,
            "instructions": SYSTEM,
            "input": [{"role": "user", "content": data}],
            "store": False,
            "stream": True,
            "parallel_tool_calls": False,
            "tools": [
                {
                    "type": "namespace",
                    "name": NAMESPACE,
                    "description": "Bounded graph investigation proposals for human review.",
                    "tools": [
                        {
                            "type": "function",
                            "name": TOOL_NAME,
                            "description": TOOL_DESCRIPTION,
                            "parameters": Selection.model_json_schema(),
                            "strict": True,
                        }
                    ],
                }
            ],
            "tool_choice": "required",
        }
        try:
            with (
                httpx.Client(
                    timeout=self._remaining(deadline),
                    follow_redirects=False,
                    transport=self.transport,
                    trust_env=False,
                ) as client,
                client.stream(
                    "POST",
                    "https://api.openai.com/v1/responses",
                    json=body,
                    headers={"Authorization": "Bearer " + token, "Accept": "text/event-stream"},
                ) as response,
            ):
                if response.status_code != 200:
                    error_body = bytearray()
                    for chunk in response.iter_bytes():
                        if len(error_body) + len(chunk) > 16000 or time.monotonic() > deadline:
                            raise ValueError("ChatGPT error response budget")
                        error_body.extend(chunk)
                    try:
                        diagnostic = json.loads(error_body)
                    except ValueError:
                        diagnostic = {}
                    raise _upstream_error(
                        diagnostic,
                        response.status_code,
                        response.headers.get(
                            "x-request-id", response.headers.get("openai-request-id")
                        ),
                    )
                # The explicit streaming public Responses route can omit this
                # header. Its body still must satisfy the complete bounded SSE
                # protocol below; a present contradictory media type is rejected.
                content_type = response.headers.get("content-type")
                if (
                    content_type is not None
                    and content_type.split(";")[0].strip().lower() != "text/event-stream"
                ):
                    raise ValueError("Expected event stream")
                result = self._consume(response, deadline)
            output = result.get("output")
            if (
                result.get("status") != "completed"
                or result.get("error")
                or not isinstance(output, list)
                or any(not isinstance(item, dict) for item in output)
            ):
                raise ValueError("Invalid completed response")
            calls = [item for item in output if item.get("type") == "function_call"]
            if (
                len(calls) != 1
                or calls[0].get("name") != TOOL_NAME
                or calls[0].get("namespace") != NAMESPACE
                or calls[0].get("status", "completed") != "completed"
                or any(
                    item.get("type") not in {"function_call", "reasoning", "message"}
                    for item in output
                )
            ):
                raise ValueError("Expected exactly one authorized tool proposal")
            arguments = calls[0].get("arguments")
            if not isinstance(arguments, str) or len(arguments.encode()) > 12000:
                raise ValueError("Invalid arguments")
            selection = Selection.model_validate_json(arguments)
            if len(selection.evidence_ids) != len(set(selection.evidence_ids)):
                raise ValueError("Duplicate evidence")
            check_selection(selection, candidates)
            usage = result.get("usage")
            if not isinstance(usage, dict):
                raise ValueError("Missing usage")
            counts = [usage.get("input_tokens"), usage.get("output_tokens")]
            if (
                any(type(count) is not int or not 0 <= count <= 100000 for count in counts)
                or counts[1] > 4096
            ):
                raise ValueError("Reported usage exceeds budget")
            return PlanResult(selection, counts[0], counts[1])
        except (httpx.HTTPError, ValidationError, ValueError, TypeError, KeyError, UnicodeError):
            raise DomainError(
                "chatgpt_unavailable",
                "ChatGPT inference failed, exceeded its budget, or returned an invalid proposal. No fallback was used.",
                502,
            ) from None

    @staticmethod
    def _remaining(deadline):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DomainError(
                "chatgpt_deadline",
                "ChatGPT planning exceeded its time budget. No fallback was used.",
                502,
            )
        return remaining

    @staticmethod
    def _consume(response, deadline):
        pending = bytearray()
        total = 0
        completed = None
        events = 0
        output = _FinalizedOutput()
        for chunk in response.iter_bytes():
            total += len(chunk)
            if time.monotonic() > deadline or total > 256 * 1024:
                raise ValueError("Stream budget exceeded")
            pending.extend(chunk)
            while b"\n" in pending:
                # SSE can use LF or CRLF. Preserve complete event boundaries across chunks.
                normalized = pending.replace(b"\r\n", b"\n")
                boundary = normalized.find(b"\n\n")
                if boundary < 0:
                    break
                event = bytes(normalized[:boundary])
                pending = bytearray(normalized[boundary + 2 :])
                lines = [
                    line[5:].lstrip(b" ")
                    for line in event.split(b"\n")
                    if line.startswith(b"data:")
                ]
                if not lines:
                    continue
                raw = b"\n".join(lines)
                if raw == b"[DONE]":
                    if completed is None:
                        raise ValueError("Missing terminal response")
                    continue
                value = json.loads(raw)
                events += 1
                if (
                    events > 4096
                    or not isinstance(value, dict)
                    or not isinstance(value.get("type"), str)
                ):
                    raise ValueError("Invalid stream event")
                kind = value["type"]
                if kind in {"response.failed", "response.incomplete", "error"}:
                    diagnostic = value.get("response", value)
                    if kind == "error" and "error" not in diagnostic:
                        diagnostic = {"error": diagnostic}
                    raise _upstream_error(
                        diagnostic,
                        response.status_code,
                        response.headers.get(
                            "x-request-id", response.headers.get("openai-request-id")
                        ),
                    )
                if kind == "response.completed":
                    if completed is not None or not isinstance(value.get("response"), dict):
                        raise ValueError("Duplicate terminal response")
                    completed = value["response"]
                elif completed is not None:
                    raise ValueError("Event after terminal response")
                else:
                    output.observe(kind, value)
        if pending.strip() or completed is None or time.monotonic() > deadline:
            raise ValueError("Interrupted response stream")
        return output.finish(completed)
