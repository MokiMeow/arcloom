"""Bounded, private credential export from an existing local Wrangler session.

This only invokes Wrangler's official token command. It never logs in, opens a
browser, runs inference, reads a project .env, or stores the returned credential.
"""

import json
import os
import re
import subprocess
import time
from pathlib import Path

MAX_RENEWAL_SECONDS = 4 * 86400


class CloudflareAuthError(Exception):
    """A sanitized diagnostic with no private subprocess exception chain."""


def renewal_deadline(value) -> int:
    """Validate a fixed Unix UTC deadline, allowing already-expired settings."""
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError("Wrangler renewal requires a Unix UTC timestamp")
    if isinstance(value, str) and not re.fullmatch(r"[0-9]{1,12}", value):
        raise ValueError("Wrangler renewal requires a Unix UTC timestamp")
    deadline = int(value)
    if deadline <= 0 or deadline > time.time() + MAX_RENEWAL_SECONDS:
        raise ValueError("Wrangler renewal deadline must be positive and at most four days ahead")
    return deadline


def credentials(*, timeout: float = 90, cwd: Path | None = None) -> tuple[str, str]:
    """Export a credential privately; an explicit process API token wins."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    kind = "api_token"
    if token is None:
        failure = None
        result = None
        try:
            result = subprocess.run(
                [
                    "npx.cmd" if os.name == "nt" else "npx",
                    "--yes",
                    "wrangler@4.151.1",
                    "auth",
                    "token",
                    "--json",
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="strict",
                shell=False,
                timeout=min(timeout, 90),
                # User auth is independent of the app's project configuration.
                cwd=cwd if cwd is not None else Path.home(),
                env=os.environ | {"WRANGLER_SEND_METRICS": "false"},
            )
        except Exception:
            failure = "Could not retrieve credentials from Wrangler; no configuration changed."
        # Raise after leaving the except block: even __context__ must not retain
        # TimeoutExpired.cmd/output/stderr or other credential-bearing messages.
        if failure:
            raise CloudflareAuthError(failure)
        if result.returncode:
            raise CloudflareAuthError(
                "Wrangler credential retrieval failed; no configuration changed."
            )
        payload = None
        try:
            payload = json.loads(result.stdout)
        except (ValueError, TypeError):
            failure = "Wrangler did not return valid credential JSON; no configuration changed."
        if failure:
            raise CloudflareAuthError(failure)
        if not isinstance(payload, dict) or payload.get("type") not in ("oauth", "api_token"):
            raise CloudflareAuthError(
                "Wrangler must provide OAuth or an API token; API key/email is unsupported."
            )
        kind, token = payload["type"], payload.get("token")
    if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._~+/=-]{1,16384}", token):
        raise CloudflareAuthError(
            "Cloudflare credentials are empty or malformed; no configuration changed."
        )
    return kind, token
