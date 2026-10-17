"""Standard-library-only local configuration. Existing secrets are never overwritten."""

import os
import secrets
from pathlib import Path

path = Path(".env")
values = {
    "ARCLOOM_ADMIN_TOKEN": secrets.token_urlsafe(36),
    "ARCLOOM_RUNNER_SECRET": secrets.token_urlsafe(36),
    "ARCLOOM_GRAPH_PASSWORD": secrets.token_urlsafe(36),
    "ARCLOOM_PROVIDER": "deterministic",
    "ARCLOOM_GRAPH_MODE": "server",
    "ARCLOOM_COOKIE_SECURE": "false",
}
try:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    raise SystemExit(".env already exists; refusing to overwrite your credentials.") from None
with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
    stream.write("# Private credentials, generated locally. Never commit this file.\n")
    stream.writelines(f"{key}={value}\n" for key, value in values.items())
print("Created .env. Use ARCLOOM_ADMIN_TOKEN from that file to sign in.")
print("No credentials were sent to a remote service.")
