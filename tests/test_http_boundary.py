import httpx
import pytest

from arcloom.domain import DomainError
from arcloom.http_boundary import bounded_json


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
