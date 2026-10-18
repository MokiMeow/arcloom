"""Exercise the actual SDK boundary; only the external HTTP service is substituted."""

import asyncio
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
from mcp import Client
from mcp.client.stdio import StdioServerParameters
from pydantic import ValidationError

from arcloom.mcp_server import MCPSettings, create_server

TOKEN = "test-mcp-viewer-" + "v" * 48


def settings(**values):
    return MCPSettings(_env_file=None, url="http://127.0.0.1:8000", token=TOKEN, **values)


def run(coroutine):
    return asyncio.run(coroutine)


def test_only_read_only_tools_are_registered_and_preserve_json():
    requests = []

    def serve(request):
        requests.append(request)
        payload = {
            "/api/memory/handoff": {"packet_version": 1, "packet_sha256": "abc"},
            "/api/investigations": {"items": [{"id": "case_example"}], "next_cursor": None},
            "/api/investigations/case_example": {"id": "case_example", "reports": []},
        }[request.url.path]
        return httpx.Response(200, json=payload, headers={"set-cookie": "secret=session"})

    async def exercise():
        async with Client(
            create_server(settings(), transport=httpx.MockTransport(serve))
        ) as client:
            tools = (await client.list_tools()).tools
            assert {tool.name for tool in tools} == {
                "arcloom_handoff",
                "arcloom_investigations",
                "arcloom_investigation",
            }
            for tool in tools:
                assert tool.annotations.read_only_hint is True
                assert tool.annotations.open_world_hint is False
                assert "untrusted" in tool.description.lower()
            schemas = {tool.name: tool.input_schema for tool in tools}
            assert schemas["arcloom_investigations"]["properties"]["limit"]["maximum"] == 20
            assert schemas["arcloom_investigation"]["properties"]["case_id"]["maxLength"] == 96
            assert not (await client.list_resources()).resources
            assert not (await client.list_prompts()).prompts
            handoff = await client.call_tool("arcloom_handoff")
            assert handoff.structured_content == {
                "ok": True,
                "data": {"packet_version": 1, "packet_sha256": "abc"},
            }
            assert json.loads(handoff.content[0].text) == handoff.structured_content
            await client.call_tool("arcloom_investigations")
            await client.call_tool("arcloom_investigations", {"limit": 20})
            detail = await client.call_tool("arcloom_investigation", {"case_id": "case_example"})
            assert detail.structured_content["data"]["id"] == "case_example"

    run(exercise())
    assert [str(request.url) for request in requests] == [
        "http://127.0.0.1:8000/api/memory/handoff",
        "http://127.0.0.1:8000/api/investigations?limit=10",
        "http://127.0.0.1:8000/api/investigations?limit=20",
        "http://127.0.0.1:8000/api/investigations/case_example",
    ]
    for request in requests:
        assert request.method == "GET"
        assert request.headers["authorization"] == "Bearer " + TOKEN
        assert "cookie" not in request.headers
        assert request.headers["accept"] == "application/json"


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com",
        "ftp://127.0.0.1",
        "https://name:secret@example.com",
        "https://@example.com",
        "http://127.0.0.1/api",
        "http://127.0.0.1?x=1",
        "http://127.0.0.1#secret",
        "http://127.0.0.1?",
        "http://127.0.0.1#",
        "http://127.0.0.1\n",
        "http://127.0.0.1:99999",
        "https://",
    ],
)
def test_url_is_a_fixed_safe_origin(url):
    with pytest.raises(ValidationError):
        MCPSettings(_env_file=None, url=url, token=TOKEN)


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8000/",
        "http://127.0.0.2:8000",
        "http://[::1]:8000",
        "https://arcloom.example.com",
    ],
)
def test_loopback_http_and_explicit_remote_https_are_supported(url):
    assert MCPSettings(_env_file=None, url=url, token=TOKEN).url == url.rstrip("/")


@pytest.mark.parametrize("token", ["", "with space", "x\nheader", "é", "x" * 4097])
def test_token_requires_a_bounded_header_safe_secret(token):
    with pytest.raises(ValidationError) as error:
        MCPSettings(_env_file=None, token=token)
    assert "input_value" not in str(error.value)


@pytest.mark.parametrize(
    ("tool", "arguments"),
    [
        ("arcloom_investigations", {"limit": 0}),
        ("arcloom_investigations", {"limit": 21}),
        ("arcloom_investigations", {"limit": True}),
        ("arcloom_investigations", {"limit": "10"}),
        ("arcloom_investigation", {"case_id": "../providers"}),
        ("arcloom_investigation", {"case_id": "case_foo/approve"}),
        ("arcloom_investigation", {"case_id": "case_foo%2Fapprove"}),
        ("arcloom_investigation", {"case_id": "x" * 97}),
        ("arcloom_investigation", {"case_id": ""}),
        ("arcloom_investigation", {}),
        ("arcloom_handoff", {"url": "https://example.com"}),
        ("arcloom_approve", {}),
    ],
)
def test_invalid_calls_cannot_reach_http_and_have_sanitized_json(tool, arguments):
    def serve(request):
        pytest.fail("Invalid arguments reached the HTTP service")

    async def exercise():
        async with Client(
            create_server(settings(), transport=httpx.MockTransport(serve))
        ) as client:
            result = await client.call_tool(tool, arguments)
            assert result.is_error
            assert result.structured_content["ok"] is False
            assert result.structured_content["error"]["code"] == "invalid_arguments"
            assert json.loads(result.content[0].text) == result.structured_content

    run(exercise())


@pytest.mark.parametrize(
    ("status", "code"),
    [
        (401, "authentication_required"),
        (403, "access_denied"),
        (404, "not_found"),
        (429, "rate_limited"),
        (500, "upstream_unavailable"),
        (302, "redirect_denied"),
    ],
)
def test_upstream_denials_are_structured_and_never_echo_body_headers_or_credentials(status, code):
    requests = []

    def serve(request):
        requests.append(request)
        return httpx.Response(
            status,
            text="private upstream error " + TOKEN,
            headers={"location": "https://user:password@elsewhere/", "x-secret": TOKEN},
        )

    async def exercise():
        async with Client(
            create_server(settings(), transport=httpx.MockTransport(serve))
        ) as client:
            result = await client.call_tool("arcloom_investigation", {"case_id": "unknown_case"})
            assert result.is_error
            assert result.structured_content["error"]["code"] == code
            serialized = result.model_dump_json()
            for private in (TOKEN, "password", "elsewhere", "private upstream", "x-secret"):
                assert private not in serialized

    run(exercise())
    assert len(requests) == 1


@pytest.mark.parametrize(
    "failure",
    ["oversize", "declared_oversize", "timeout", "network", "invalid_json", "secret_echo"],
)
def test_failed_or_unbounded_responses_are_safe(failure):
    def serve(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("private " + TOKEN, request=request)
        if failure == "network":
            raise httpx.ConnectError("private " + TOKEN, request=request)
        if failure == "oversize":
            return httpx.Response(200, content=b"x" * (2 * 1024 * 1024 + 1))
        if failure == "declared_oversize":
            return httpx.Response(200, content=b"{}", headers={"content-length": "999999999"})
        if failure == "secret_echo":
            return httpx.Response(200, json={"accidental_secret": TOKEN})
        return httpx.Response(200, content=b"private non-json body")

    async def exercise():
        async with Client(
            create_server(settings(), transport=httpx.MockTransport(serve))
        ) as client:
            result = await client.call_tool("arcloom_handoff")
            assert result.is_error
            assert result.structured_content["ok"] is False
            assert TOKEN not in result.model_dump_json()
            assert "private" not in result.model_dump_json()

    run(exercise())


def test_streamed_body_stops_at_limit_without_consuming_the_rest():
    consumed = []

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index in range(40):
                consumed.append(index)
                yield b"x" * 65536

    async def exercise():
        transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=Stream()))
        async with Client(create_server(settings(), transport=transport)) as client:
            result = await client.call_tool("arcloom_handoff")
            assert result.structured_content["error"]["code"] == "response_too_large"

    run(exercise())
    assert len(consumed) == 33


def test_total_timeout_stops_a_slow_trickling_body(monkeypatch):
    monkeypatch.setattr("arcloom.mcp_server.REQUEST_SECONDS", 0.03)

    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            while True:
                await asyncio.sleep(0.01)
                yield b" "

    async def exercise():
        transport = httpx.MockTransport(lambda request: httpx.Response(200, stream=Stream()))
        async with Client(create_server(settings(), transport=transport)) as client:
            result = await client.call_tool("arcloom_handoff")
            assert result.structured_content["error"]["code"] == "upstream_timeout"

    run(exercise())


def test_compressed_upstream_is_rejected_before_decompression():
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            pytest.fail("Compressed body must not be read or decompressed")
            yield b""

    async def exercise():
        transport = httpx.MockTransport(
            lambda request: httpx.Response(
                200, headers={"content-encoding": "gzip"}, stream=Stream()
            )
        )
        async with Client(create_server(settings(), transport=transport)) as client:
            result = await client.call_tool("arcloom_handoff")
            assert result.structured_content["error"]["code"] == "invalid_response"

    run(exercise())


def test_stdio_sdk_subprocess_negotiates_lists_and_calls_tools():
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append((self.path, self.headers.get("Authorization"), self.headers.get("Cookie")))
            body = json.dumps({"packet_version": 1, "packet_sha256": "stdio-smoke"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()

    async def exercise():
        parameters = StdioServerParameters(
            command=sys.executable,
            args=["-m", "arcloom.mcp_server"],
            env={
                "ARCLOOM_MCP_URL": f"http://127.0.0.1:{upstream.server_port}",
                "ARCLOOM_MCP_TOKEN": TOKEN,
            },
        )
        # Both current and initialize-era clients use the official SDK stdio transport.
        for mode in ("auto", "legacy"):
            async with Client(parameters, mode=mode, read_timeout_seconds=10) as client:
                assert len((await client.list_tools()).tools) == 3
                result = await client.call_tool("arcloom_handoff")
                assert result.structured_content["data"]["packet_sha256"] == "stdio-smoke"

    try:
        run(exercise())
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)
    assert seen == [("/api/memory/handoff", "Bearer " + TOKEN, None)] * 2


def test_invalid_startup_never_prints_credentials_to_stdout_or_stderr():
    env = {
        **os.environ,
        "ARCLOOM_MCP_URL": f"https://name:{TOKEN}@example.com",
        "ARCLOOM_MCP_TOKEN": TOKEN,
    }
    process = subprocess.run(
        [sys.executable, "-m", "arcloom.mcp_server"],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert process.returncode != 0
    assert process.stdout == ""
    assert TOKEN not in process.stderr
    assert "example.com" not in process.stderr


def test_missing_member_token_fails_closed(monkeypatch):
    monkeypatch.delenv("ARCLOOM_MCP_TOKEN", raising=False)
    with pytest.raises(ValidationError):
        MCPSettings(_env_file=None)
