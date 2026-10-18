"""Bound both bytes and elapsed time while reading an upstream response."""

import asyncio
import json
import time

import httpx

from arcloom.domain import DomainError


class DeadlineTransport(httpx.BaseTransport):
    """Cancel real network I/O under one deadline for synchronous callers.

    HTTPX's ordinary socket timeouts apply separately to each I/O phase. An
    async cancellation scope instead covers connection, headers and all body
    reads together. The async response/client close before returning a bounded
    synchronous response; no inference worker is left running after timeout.

    This is an application deadline, not a hard real-time guarantee: OS DNS
    resolution, scheduling and cancellation/connection cleanup can add overhead.
    Call from sync server workers, not a thread already running an event loop.
    """

    def __init__(
        self,
        seconds: float,
        *,
        maximum: int = 128 * 1024,
        error_prefix="upstream",
        deadline: float | None = None,
    ):
        self.deadline = time.monotonic() + seconds
        if deadline is not None:
            self.deadline = min(self.deadline, deadline)
        self.maximum = maximum
        self.error_prefix = error_prefix

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        if time.monotonic() >= self.deadline:
            raise DomainError(
                self.error_prefix + "_deadline",
                "The upstream response exceeded its time budget",
                502,
            )
        running_loop = False
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            pass
        else:
            running_loop = True
        if running_loop:
            # Check before creating a coroutine: no unawaited-coroutine warning,
            # background thread, or second event loop can conceal continuing I/O.
            raise DomainError(
                self.error_prefix + "_context",
                "The synchronous upstream transport requires a synchronous worker",
                503,
            )
        return asyncio.run(self._request(request))

    async def _request(self, request: httpx.Request) -> httpx.Response:
        timed_out = False
        try:
            async with asyncio.timeout(max(0, self.deadline - time.monotonic())):
                remaining = max(0, self.deadline - time.monotonic())
                headers = [
                    (key, value)
                    for key, value in request.headers.multi_items()
                    if key.lower() != "accept-encoding"
                ]
                headers.append(("Accept-Encoding", "identity"))
                async with (
                    httpx.AsyncClient(
                        timeout=remaining, follow_redirects=False, trust_env=False
                    ) as client,
                    client.stream(
                        request.method, request.url, content=request.read(), headers=headers
                    ) as response,
                ):
                    # Identity encoding bounds network and decoded bytes equally.
                    # Reject a peer ignoring this request rather than decompress
                    # twice when converting the async body to a sync response.
                    if response.headers.get("content-encoding", "identity").lower() != "identity":
                        raise DomainError(
                            self.error_prefix + "_encoding",
                            "The upstream response used an unsupported content encoding",
                            502,
                        )
                    content = bytearray()
                    async for chunk in response.aiter_raw():
                        if len(content) + len(chunk) > self.maximum:
                            raise DomainError(
                                self.error_prefix + "_size",
                                "The upstream response exceeded its size budget",
                                502,
                            )
                        content.extend(chunk)
                    return httpx.Response(
                        response.status_code, headers=response.headers, content=bytes(content)
                    )
        except (TimeoutError, httpx.TimeoutException):
            timed_out = True
        if timed_out:
            # No nested exception can retain request headers or upstream bodies.
            raise DomainError(
                self.error_prefix + "_deadline",
                "The upstream response exceeded its time budget",
                502,
            )


def bounded_json(
    client: httpx.Client,
    url: str,
    *,
    body: dict,
    headers: dict,
    maximum: int = 128 * 1024,
    seconds: float = 30,
    error_prefix: str = "upstream",
) -> dict:
    deadline = time.monotonic() + seconds
    with client.stream("POST", url, json=body, headers=headers) as response:
        response.raise_for_status()
        content = bytearray()
        # Preserve network chunk boundaries: buffering 8 KiB first lets a
        # trickling peer postpone the elapsed-time check across many reads.
        for chunk in response.iter_bytes():
            if time.monotonic() > deadline:
                raise DomainError(
                    error_prefix + "_deadline",
                    "The upstream response exceeded its time budget",
                    502,
                )
            if len(content) + len(chunk) > maximum:
                raise DomainError(
                    error_prefix + "_size", "The upstream response exceeded its size budget", 502
                )
            content.extend(chunk)
    result = json.loads(content)
    if not isinstance(result, dict):
        raise ValueError("Upstream response must be a JSON object")
    return result
