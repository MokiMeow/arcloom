import asyncio
import gzip
import select
import threading
import time
from contextlib import contextmanager, suppress
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest

from arcloom.domain import DomainError
from arcloom.http_boundary import DeadlineTransport, bounded_json


@pytest.mark.parametrize("body", [[], 4, "text", None])
def test_upstream_requires_object(body):
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=body))
        ) as client,
        pytest.raises(ValueError),
    ):
        bounded_json(client, "https://unit.invalid", body={}, headers={})


def test_upstream_limits_bytes():
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"x" * 33))
        ) as client,
        pytest.raises(DomainError, match="size budget"),
    ):
        bounded_json(client, "https://unit.invalid", body={}, headers={}, maximum=32)


def test_upstream_enforces_elapsed_deadline():
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"ok": True}))
        ) as client,
        pytest.raises(DomainError, match="time budget"),
    ):
        bounded_json(client, "https://unit.invalid", body={}, headers={}, seconds=-1)


def test_upstream_http_error_is_not_success():
    with (
        httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(503))) as client,
        pytest.raises(httpx.HTTPStatusError),
    ):
        bounded_json(client, "https://unit.invalid", body={}, headers={})


def test_upstream_valid_receipt():
    with httpx.Client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"ok": True}))
    ) as client:
        assert bounded_json(client, "https://unit.invalid", body={}, headers={}) == {"ok": True}


def test_deadline_is_checked_between_small_network_chunks(monkeypatch):
    now, consumed = [0.0], []

    class SlowStream(httpx.SyncByteStream):
        def __iter__(self):
            for index in range(16):
                consumed.append(index)
                now[0] = 2.0
                yield b" " * 1024

    monkeypatch.setattr("arcloom.http_boundary.time.monotonic", lambda: now[0])
    with (
        httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=SlowStream()))
        ) as client,
        pytest.raises(DomainError, match="time budget"),
    ):
        bounded_json(client, "https://unit.invalid", body={}, headers={}, seconds=1)
    assert consumed == [0]


def test_actual_runner_cancels_combined_header_and_body_wait_at_one_deadline():
    """Each phase fits .5s independently; together they exceed the total budget."""
    from arcloom.config import Settings
    from arcloom.lab import RunPlan
    from arcloom.runner import HttpRunner

    disconnected_before_body = threading.Event()

    class Delayed(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            time.sleep(0.4)
            self.send_response(200)
            self.send_header("Content-Length", "2")
            self.end_headers()
            # A cancelled request closes its connection while the peer is
            # still waiting to send a body, rather than leaving a worker alive.
            readable, _, _ = select.select([self.connection], [], [], 0.4)
            if readable:
                try:
                    closed = self.connection.recv(1) == b""
                except ConnectionError:
                    closed = True  # Windows reports cancellation as an abort.
                if closed:
                    disconnected_before_body.set()
                    return
            with suppress(OSError):
                self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    with HTTPServer(("127.0.0.1", 0), Delayed) as server:
        server.timeout = 2
        thread = threading.Thread(target=server.handle_request)
        thread.start()
        settings = Settings(
            _env_file=None,
            lab_url=f"http://127.0.0.1:{server.server_port}",
            lab_timeout_seconds=0.5,
            runner_secret="test-only-" + "x" * 40,
        )
        plan = RunPlan(
            run_id="run_deadline",
            case_id="case_deadline",
            tenant="lab-01",
            test_id="gateway-boundary",
            revision="r1",
            asset_id="gateway",
        )
        try:
            started = time.monotonic()
            with pytest.raises(DomainError):
                HttpRunner(settings).execute(plan)
            elapsed = time.monotonic() - started
        finally:
            thread.join(timeout=2)
        assert not thread.is_alive()
    assert elapsed < 0.7, f"Per-phase timeouts allowed a {elapsed:.3f}s request"
    assert disconnected_before_body.is_set()


@pytest.fixture
def actual_response():
    @contextmanager
    def serve(content, *, encoding=None):
        seen = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                seen.append(
                    (
                        self.headers.get("Accept-Encoding"),
                        self.rfile.read(int(self.headers["Content-Length"])),
                    )
                )
                self.send_response(200)
                self.send_header("Content-Length", str(len(content)))
                if encoding:
                    self.send_header("Content-Encoding", encoding)
                self.end_headers()
                with suppress(OSError):
                    self.wfile.write(content)

            def log_message(self, *args):
                pass

        with HTTPServer(("127.0.0.1", 0), Handler) as server:
            server.timeout = 2
            thread = threading.Thread(target=server.handle_request)
            thread.start()
            try:
                yield f"http://127.0.0.1:{server.server_port}", seen
            finally:
                thread.join(timeout=2)
            assert not thread.is_alive()

    return serve


def test_deadline_transport_returns_actual_json_with_identity_encoding(actual_response):
    with (
        actual_response(b'{"ok":true}') as (url, seen),
        httpx.Client(transport=DeadlineTransport(2)) as client,
    ):
        assert bounded_json(client, url, body={"test": True}, headers={}) == {"ok": True}
    assert seen == [("identity", b'{"test":true}')]


def test_deadline_transport_rejects_oversized_wire_body(actual_response):
    with (
        actual_response(b" " * 33) as (url, _),
        httpx.Client(transport=DeadlineTransport(2, maximum=32)) as client,
        pytest.raises(DomainError, match="size budget"),
    ):
        bounded_json(client, url, body={}, headers={})


def test_deadline_transport_rejects_peer_ignoring_identity_encoding(actual_response):
    with (
        actual_response(gzip.compress(b'{"ok":true}'), encoding="gzip") as (url, _),
        httpx.Client(transport=DeadlineTransport(2)) as client,
        pytest.raises(DomainError, match="content encoding"),
    ):
        bounded_json(client, url, body={}, headers={})


def test_deadline_transport_rejects_active_event_loop_before_creating_coroutine():
    async def call():
        with (
            httpx.Client(transport=DeadlineTransport(1)) as client,
            pytest.raises(DomainError, match="synchronous worker") as error,
        ):
            bounded_json(client, "https://unit.invalid", body={}, headers={})
        assert error.value.code == "upstream_context"

    asyncio.run(call())


def test_absolute_planning_deadline_cannot_be_extended_by_a_fresh_transport(monkeypatch):
    def forbidden(*args, **kwargs):
        pytest.fail("An expired absolute planning budget must not start a network client")

    monkeypatch.setattr(httpx, "AsyncClient", forbidden)
    with (
        httpx.Client(transport=DeadlineTransport(30, deadline=time.monotonic() - 1)) as client,
        pytest.raises(DomainError, match="time budget"),
    ):
        bounded_json(client, "https://unit.invalid", body={}, headers={})
