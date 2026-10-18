"""Privately copy current Cloudflare credentials into the local Arcloom .env.

Run with the project's Python environment. --refresh-only updates only the
credential of an existing, matching Cloudflare .env within an explicitly opted
in, fixed four-day renewal window. No inference requests are made here.
"""

import argparse
import io
import os
import re
import stat
import sys
import tempfile
import time
from contextlib import suppress
from pathlib import Path

from dotenv.parser import parse_stream

from arcloom.cloudflare_auth import CloudflareAuthError, renewal_deadline
from arcloom.cloudflare_auth import credentials as export_credentials
from arcloom.cloudflare_auth import subprocess as subprocess

ROOT = Path(__file__).resolve().parents[1]
MODELS = ("clef", "clef-flash", "clef-omni")


SetupError = CloudflareAuthError


def account_id(value):
    if not re.fullmatch(r"[0-9a-f]{32}", value):
        raise argparse.ArgumentTypeError("account ID must be 32 lowercase hexadecimal characters")
    return value


def credentials():
    return export_credentials()


def refresh_destination(path, account):
    """Check the explicitly supplied destination without process-env overrides."""
    validate_destination(path.absolute())
    if not path.exists():
        raise SetupError("Refresh requires an existing Cloudflare .env; no configuration changed.")
    values = {}
    for binding in parse_stream(io.StringIO(path.read_text(encoding="utf-8-sig"))):
        if binding.error:
            raise SetupError("Existing .env has invalid dotenv syntax; no configuration changed.")
        if binding.key:
            values[binding.key.upper()] = binding.value
    if (
        values.get("ARCLOOM_PROVIDER") != "cloudflare"
        or values.get("ARCLOOM_CLOUDFLARE_ACCOUNT_ID") != account
    ):
        raise SetupError("Refresh requires a matching Cloudflare provider and account in .env.")
    deadline = None
    with suppress(ValueError):
        deadline = renewal_deadline(values.get("ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL"))
    if deadline is None or deadline <= time.time():
        raise SetupError(
            "Refresh requires an unexpired Wrangler renewal window of at most four days."
        )
    return deadline


def validate_destination(path):
    # Check before reading and again immediately before the atomic replacement.
    # Do not follow an explicitly supplied symlink or Windows junction.
    for item in (path, *path.parents):
        if item.is_symlink() or item.is_junction():
            raise SetupError("Refusing to write configuration through a symlink or junction.")
    if path.exists() and not stat.S_ISREG(path.stat().st_mode):
        raise SetupError("Configuration destination must be a regular file.")


def update_dotenv(path, values):
    path = path.absolute()
    validate_destination(path)
    original = path.read_bytes() if path.exists() else b""
    bom = b"\xef\xbb\xbf" if original.startswith(b"\xef\xbb\xbf") else b""
    content = original.decode("utf-8-sig")
    newline = "\r\n" if "\r\n" in content else "\n"
    remaining = dict(values)
    chunks = []
    # Use the project's dotenv parser so unrelated quoted/multiline fields are
    # preserved exactly, including lines that look like assignments inside them.
    for binding in parse_stream(io.StringIO(content)):
        if binding.error:
            raise SetupError("Existing .env has invalid dotenv syntax; no configuration changed.")
        # Settings resolves environment names without regard to case. Remove
        # aliases of the fields we own while preserving all other spelling.
        key = binding.key.upper() if binding.key is not None else None
        if key not in values:
            chunks.append(binding.original.string)
            continue
        prefix = re.match(r"\s*", binding.original.string).group()
        chunks.append(prefix)
        if key in remaining:
            chunks.append(f"{key}={remaining.pop(key)}{newline}")
    rewritten = "".join(chunks)
    if rewritten and not rewritten.endswith(("\n", "\r")):
        rewritten += newline
    rewritten += "".join(f"{key}={value}{newline}" for key, value in remaining.items())

    descriptor, temporary = tempfile.mkstemp(prefix=".env.cloudflare-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            if os.name != "nt":
                os.fchmod(stream.fileno(), 0o600)
            stream.write(bom + rewritten.encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        validate_destination(path)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account-id", required=True, type=account_id)
    parser.add_argument(
        "--model",
        choices=MODELS + tuple("@cf/cloudflare/" + model for model in MODELS),
        default=None,
    )
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    parser.add_argument("--refresh-only", action="store_true")
    parser.add_argument("--wrangler-until", help="Fixed renewal deadline as a Unix UTC timestamp")
    args = parser.parse_args(argv)
    try:
        validate_destination(args.env_file.absolute())
        if args.refresh_only and (args.model is not None or args.wrangler_until is not None):
            raise SetupError("Refresh-only cannot change the model or renewal deadline.")
        deadline = (
            refresh_destination(args.env_file, args.account_id) if args.refresh_only else None
        )
        if args.wrangler_until is not None:
            with suppress(ValueError):
                deadline = renewal_deadline(args.wrangler_until)
            if deadline is None or deadline <= time.time():
                raise SetupError("Use a future Unix UTC deadline within four days.")
        kind, token = credentials()
        if args.refresh_only:
            # Recheck ownership/deadline after CLI work before writing a secret.
            refresh_destination(args.env_file, args.account_id)
            values = {"ARCLOOM_MODEL_API_KEY": token}
        else:
            selected = args.model or "clef-flash"
            model = selected if selected.startswith("@cf/") else "@cf/cloudflare/" + selected
            values = {
                "ARCLOOM_PROVIDER": "cloudflare",
                "ARCLOOM_MODEL": model,
                "ARCLOOM_CLOUDFLARE_ACCOUNT_ID": args.account_id,
                "ARCLOOM_MODEL_API_KEY": token,
            }
            if deadline is not None:
                values["ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL"] = str(deadline)
        update_dotenv(args.env_file, values)
    except SetupError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except (OSError, UnicodeError):
        # Neither exception details nor subprocess output are safe to forward:
        # they can contain credentials. There are no secret backup files.
        print(
            "Could not safely update the local .env; no credentials were printed.", file=sys.stderr
        )
        return 1
    if args.refresh_only:
        print("Refreshed only the Cloudflare credential in the existing local .env.")
        print("Provider, model, account and other settings were preserved.")
        return 0
    print(f"Configured Cloudflare {model} in the local .env. Restart the backend to load it.")
    if kind == "oauth":
        print("Credential type: OAuth access token. This copied token will expire.")
        print(
            "Refresh it using the same command: python scripts/cloudflare_setup.py "
            f"--account-id {args.account_id} --model {args.model or 'clef-flash'}"
        )
        if args.env_file != ROOT / ".env":
            print("Include your original --env-file argument when refreshing a custom destination.")
        print(
            "Wrangler refreshes its session automatically. The app renews environment-owned "
            "credentials only within ARCLOOM_CLOUDFLARE_WRANGLER_UNTIL when explicitly enabled."
        )
    else:
        print("Credential type: API token. Its configured expiry and permissions still apply.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
