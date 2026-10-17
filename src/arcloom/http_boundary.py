"""Bound both bytes and elapsed time while reading an upstream response."""

import json
import time

import httpx

from arcloom.domain import DomainError


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
        for chunk in response.iter_bytes(chunk_size=8192):
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
