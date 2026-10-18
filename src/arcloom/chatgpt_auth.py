"""Public-client Sign in with ChatGPT, independent of Codex/browser credentials.

Protocol: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
Only this application's validated OAuth grants are read or written here.
"""

import base64
import ctypes
import hashlib
import json
import os
import re
import secrets
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import jwt

from arcloom.domain import DomainError

ISSUER = "https://auth.openai.com"
AUTHORIZE = ISSUER + "/api/accounts/authorize"
TOKEN = ISSUER + "/api/accounts/oauth/token"
DISCOVERY = ISSUER + "/.well-known/openid-configuration"
RESOURCE = "https://api.openai.com/v1"
SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
PERMISSION = "chatgpt.tokens.use.direct"
TERMINAL_REFRESH = {
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
}


def auth_required():
    return DomainError(
        "chatgpt_auth_required",
        "Continue with ChatGPT and allow ChatGPT plan usage before making a request.",
        403,
    )


def _dpapi(data: bytes, *, decrypt: bool = False) -> bytes:
    """Windows user-bound encryption; fail closed rather than writing plaintext."""
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    output = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if decrypt:
        operation = crypt.CryptUnprotectData
        operation.argtypes = [
            ctypes.POINTER(Blob),
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(Blob),
        ]
        ok = operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output))
    else:
        operation = crypt.CryptProtectData
        operation.argtypes = [
            ctypes.POINTER(Blob),
            wintypes.LPCWSTR,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
            wintypes.DWORD,
            ctypes.POINTER(Blob),
        ]
        ok = operation(
            ctypes.byref(source),
            "Arcloom ChatGPT credentials",
            None,
            None,
            None,
            1,
            ctypes.byref(output),
        )
    if not ok:
        raise OSError("Protected ChatGPT credential storage is unavailable")
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        kernel.LocalFree(ctypes.cast(output.pbData, ctypes.c_void_p))


class ChatGPTAuth:
    def __init__(self, settings, transport: httpx.BaseTransport | None = None):
        self.settings, self.transport = settings, transport
        self.credential_path = Path(settings.data_dir) / "private" / "chatgpt-credentials.bin"
        self._mutex = threading.RLock()
        self._pending = None
        self._server = None
        self._thread = None
        self._last_error = None
        self._revocation_confirmed = None
        self._keys = None
        self._keys_at = 0.0
        self._generation = 0
        self._budgets = threading.local()

    @contextmanager
    def request_budget(self, deadline):
        """Share a caller's monotonic deadline across refresh, discovery, and catalog calls."""
        previous = getattr(self._budgets, "deadline", None)
        self._budgets.deadline = min(previous, deadline) if previous is not None else deadline
        try:
            yield
        finally:
            self._budgets.deadline = previous

    @contextmanager
    def _locked(self):
        """Lock across instances/processes before reading a rotating token set."""
        with self._mutex:
            directory = self.credential_path.parent
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            if directory.is_symlink() or self.credential_path.is_symlink():
                raise DomainError("chatgpt_storage", "ChatGPT credential storage is unsafe", 503)
            if os.name != "nt":
                os.chmod(directory, 0o700)
            lock_path = directory / "chatgpt.lock"
            if lock_path.is_symlink():
                raise DomainError("chatgpt_storage", "ChatGPT credential storage is unsafe", 503)
            descriptor = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            locked = False
            try:
                if os.fstat(descriptor).st_size == 0:
                    os.write(descriptor, b"0")
                deadline = time.monotonic() + 10
                while not locked:
                    try:
                        os.lseek(descriptor, 0, os.SEEK_SET)
                        if os.name == "nt":
                            import msvcrt

                            msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                        else:
                            import fcntl

                            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        locked = True
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise DomainError(
                                "chatgpt_busy",
                                "Another ChatGPT credential operation is still running",
                                503,
                            ) from None
                        time.sleep(0.025)
                yield
            finally:
                if locked:
                    os.lseek(descriptor, 0, os.SEEK_SET)
                    if os.name == "nt":
                        import msvcrt

                        msvcrt.locking(descriptor, msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(descriptor, fcntl.LOCK_UN)
                os.close(descriptor)

    def _read(self):
        if not self.credential_path.exists():
            return {
                "version": 1,
                "host_id": "urn:uuid:" + str(uuid.uuid4()),
                "active": None,
                "profiles": {},
            }
        try:
            if self.credential_path.stat().st_size > 1024 * 1024:
                raise ValueError("Oversized credentials")
            data = self.credential_path.read_bytes()
            if os.name == "nt":
                if not data.startswith(b"DPAPI1\n"):
                    raise ValueError("Unprotected credentials")
                data = _dpapi(data[7:], decrypt=True)
            elif self.credential_path.stat().st_mode & 0o077:
                raise ValueError("Credential permissions")
            value = json.loads(data)
            if value.get("version") != 1 or not isinstance(value.get("profiles"), dict):
                raise ValueError("Credential format")
            return value
        except (OSError, ValueError, TypeError, AttributeError):
            raise DomainError(
                "chatgpt_storage", "Protected ChatGPT credentials could not be read", 503
            ) from None

    def _write(self, value):
        data = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode()
        if os.name == "nt":
            data = b"DPAPI1\n" + _dpapi(data)
        descriptor, temporary = tempfile.mkstemp(
            prefix=".chatgpt-", dir=self.credential_path.parent
        )
        try:
            if os.name != "nt":
                os.fchmod(descriptor, 0o600)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.credential_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    @staticmethod
    def _connected(profile):
        return bool(
            profile.get("access_token")
            and profile.get("refresh_token")
            and PERMISSION in profile.get("scopes", [])
            and "resource.invoke" in profile.get("scopes", [])
        )

    def status(self):
        with self._locked():
            value = self._read()
            active = value["active"]
            profiles = [
                {
                    "id": key,
                    "email": profile.get("email", ""),
                    "label": profile["label"],
                    "connected": self._connected(profile),
                }
                for key, profile in value["profiles"].items()
            ]
            return {
                "connected": self._connected(value["profiles"].get(active, {})),
                "active_profile_id": active,
                "profiles": profiles,
                "pending": bool(self._pending and self._pending["expires_at"] > time.time()),
                "last_error": self._last_error,
                "revocation_confirmed": self._revocation_confirmed,
            }

    def _request(self, method, url, *, maximum=128 * 1024, **kwargs):
        deadline = time.monotonic() + self.settings.model_timeout_seconds
        shared = getattr(self._budgets, "deadline", None)
        if shared is not None:
            deadline = min(deadline, shared)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError("ChatGPT request deadline")
        with (
            httpx.Client(
                timeout=remaining,
                follow_redirects=False,
                trust_env=False,
                transport=self.transport,
            ) as client,
            client.stream(method, url, **kwargs) as response,
        ):
            data = bytearray()
            for chunk in response.iter_bytes():
                if len(data) + len(chunk) > maximum or time.monotonic() > deadline:
                    raise ValueError("ChatGPT response budget")
                data.extend(chunk)
            if time.monotonic() > deadline:
                raise ValueError("ChatGPT response deadline")
            return response.status_code, json.loads(data) if data else {}

    def _json(self, method, url, **kwargs):
        status, value = self._request(method, url, **kwargs)
        if status != 200 or not isinstance(value, dict):
            raise ValueError("ChatGPT upstream request failed")
        return value

    def _metadata(self):
        metadata = self._json("GET", DISCOVERY)
        if metadata.get("issuer") != ISSUER:
            raise ValueError("Unexpected identity issuer")
        return metadata

    @staticmethod
    def _trusted_endpoint(url):
        parsed = urlsplit(url if isinstance(url, str) else "")
        if (
            parsed.scheme != "https"
            or parsed.netloc != "auth.openai.com"
            or parsed.username
            or parsed.fragment
            or parsed.query
        ):
            raise ValueError("Unexpected identity endpoint")
        return url

    def _identity(self, token, client_id, nonce=None):
        if not isinstance(token, str) or len(token) > 32000:
            raise ValueError("Invalid identity token")
        header = jwt.get_unverified_header(token)
        # Algorithms come from an application allowlist, never from untrusted JWT input.
        if header.get("alg") not in {"RS256", "ES256"} or not isinstance(header.get("kid"), str):
            raise ValueError("Unsupported identity signature")
        for attempt in range(2):
            if attempt or self._keys is None or time.monotonic() - self._keys_at > 300:
                metadata = self._metadata()
                key_url = self._trusted_endpoint(metadata.get("jwks_uri"))
                self._keys = self._json("GET", key_url).get("keys", [])
                self._keys_at = time.monotonic()
            matches = [
                key
                for key in self._keys
                if isinstance(key, dict)
                and key.get("kid") == header["kid"]
                and key.get("use", "sig") == "sig"
            ]
            if len(matches) == 1:
                break
        if len(matches) != 1:
            raise ValueError("Unknown identity key")
        claims = jwt.decode(
            token,
            jwt.PyJWK.from_dict(matches[0]),
            algorithms=["RS256", "ES256"],
            issuer=ISSUER,
            audience=client_id,
            leeway=5,
            options={"require": ["iss", "aud", "exp", "iat", "sub"]},
        )
        if not isinstance(claims.get("sub"), str) or not claims["sub"]:
            raise ValueError("Missing identity")
        if nonce is not None and claims.get("nonce") != nonce:
            raise ValueError("Invalid identity nonce")
        if (
            isinstance(claims["aud"], list)
            and len(claims["aud"]) > 1
            and claims.get("azp") != client_id
        ):
            raise ValueError("Invalid authorized party")
        return claims

    def start(self, profile_id=None):
        self.close()
        with self._locked():
            value = self._read()
            profile = value["profiles"].get(profile_id) if profile_id else None
            if profile_id and profile is None:
                raise auth_required()
            self._write(value)  # Persist host identity before showing the first URL.
            owner = self

            class Callback(BaseHTTPRequestHandler):
                def log_message(self, *_args):
                    pass  # Request targets contain OAuth authorization codes.

                def do_GET(self):
                    self.connection.settimeout(2)
                    ok = owner._callback(self.path, self.headers.get("Host", ""))
                    message = (
                        b"ChatGPT connection saved. You can close this window."
                        if ok
                        else b"ChatGPT sign-in could not be verified. Return to Arcloom and try again."
                    )
                    self.send_response(200 if ok else 400)
                    self.send_header("Content-Type", "text/plain; charset=utf-8")
                    self.send_header("Content-Length", str(len(message)))
                    self.send_header("Cache-Control", "no-store")
                    self.send_header("Referrer-Policy", "no-referrer")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.end_headers()
                    self.wfile.write(message)

            class LoopbackServer(HTTPServer):
                def get_request(self):
                    connection, address = super().get_request()
                    connection.settimeout(2)
                    return connection, address

            server = LoopbackServer(("127.0.0.1", 0), Callback)
            server.timeout = 0.2
            redirect = f"http://127.0.0.1:{server.server_port}/auth/callback"
            pending = {
                "state": secrets.token_urlsafe(32),
                "nonce": secrets.token_urlsafe(32),
                "verifier": secrets.token_urlsafe(64),
                "redirect_uri": redirect,
                "expires_at": time.time() + 300,
                "profile_id": profile_id,
                "client_id": profile["client_id"] if profile else "dynamic_agent_client",
                "generation": self._generation,
                "consumed": False,
            }
            self._pending, self._server, self._last_error = pending, server, None
            params = {
                "client_id": pending["client_id"],
                "ext_agent_host_id": value["host_id"],
                "response_type": "code",
                "redirect_uri": redirect,
                "scope": SCOPES,
                "resource": RESOURCE,
                "state": pending["state"],
                "nonce": pending["nonce"],
                "code_challenge_method": "S256",
                "code_challenge": base64.urlsafe_b64encode(
                    hashlib.sha256(pending["verifier"].encode()).digest()
                )
                .rstrip(b"=")
                .decode(),
            }
            if profile:
                if profile.get("id_token"):
                    params["id_token_hint"] = profile["id_token"]
                if profile.get("email"):
                    params["login_hint"] = profile["email"]
                if PERMISSION not in profile.get("scopes", []):
                    params["prompt"] = "consent"
            else:
                params["agent_name_hint"] = "Arcloom"

            def listen():
                try:
                    while self._pending is pending and time.time() < pending["expires_at"]:
                        server.handle_request()
                finally:
                    server.server_close()
                    with self._mutex:
                        if self._pending is pending:
                            self._pending = None
                            self._last_error = "ChatGPT sign-in expired. Try again."

            self._thread = threading.Thread(
                target=listen, daemon=True, name="arcloom-chatgpt-oauth"
            )
            self._thread.start()
            return {
                "authorization_url": AUTHORIZE + "?" + urlencode(params),
                "expires_at": pending["expires_at"],
            }

    def _callback(self, target, host):
        pending = None
        claimed = False
        try:
            with self._mutex:
                pending = self._pending
                if not pending or pending["consumed"] or pending["expires_at"] <= time.time():
                    raise ValueError("Expired attempt")
                parsed = urlsplit(target)
                if (
                    host != urlsplit(pending["redirect_uri"]).netloc
                    or parsed.path != "/auth/callback"
                    or parsed.scheme
                    or parsed.netloc
                    or parsed.fragment
                    or len(target) > 16384
                ):
                    raise ValueError("Unexpected callback")
                query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=16)
                if any(len(values) != 1 for values in query.values()) or not secrets.compare_digest(
                    query.get("state", [""])[0], pending["state"]
                ):
                    raise ValueError("Invalid callback state")
                # Keep the attempt pending while network/identity checks run, so polling
                # callers observe completion only after the credential transaction commits.
                pending["consumed"] = True
                claimed = True
            if "error" in query or not query.get("code", [""])[0]:
                raise ValueError("Authorization declined")
            client_id = query.get("client_id", [pending["client_id"]])[0]
            if not re.fullmatch(r"oaiapp_[A-Za-z0-9_-]{1,200}", client_id) or (
                pending["client_id"] != "dynamic_agent_client" and client_id != pending["client_id"]
            ):
                raise ValueError("Registration mismatch")
            tokens = self._json(
                "POST",
                TOKEN,
                data={
                    "grant_type": "authorization_code",
                    "client_id": client_id,
                    "code": query["code"][0],
                    "code_verifier": pending["verifier"],
                    "redirect_uri": pending["redirect_uri"],
                    "resource": RESOURCE,
                },
            )
            claims = self._identity(tokens.get("id_token"), client_id, pending["nonce"])
            with self._locked():
                if (
                    pending["generation"] != self._generation
                    or pending["expires_at"] <= time.time()
                ):
                    raise ValueError("Cancelled sign-in")
                value = self._read()
                old = value["profiles"].get(pending["profile_id"])
                if old and (old["subject"] != claims["sub"] or old["client_id"] != client_id):
                    raise ValueError("Selected identity mismatch")
                if any(
                    p["client_id"] == client_id and p["subject"] != claims["sub"]
                    for p in value["profiles"].values()
                ):
                    raise ValueError("Registration identity mismatch")
                profile_id = (
                    pending["profile_id"]
                    or hashlib.sha256(f"{ISSUER}|{client_id}|{claims['sub']}".encode()).hexdigest()[
                        :24
                    ]
                )
                profile = {
                    "issuer": ISSUER,
                    "subject": claims["sub"],
                    "client_id": client_id,
                    "email": claims.get("email", "")
                    if isinstance(claims.get("email", ""), str)
                    else "",
                    "label": old["label"] if old else "ChatGPT account " + profile_id[:8],
                    "id_token": tokens["id_token"],
                }
                self._apply_tokens(profile, tokens, initial=True)
                value["profiles"][profile_id] = profile
                value["active"] = profile_id
                self._write(value)
            with self._mutex:
                if pending["generation"] == self._generation:
                    self._last_error = None
            return True
        except (
            DomainError,
            httpx.HTTPError,
            jwt.PyJWTError,
            ValueError,
            TypeError,
            KeyError,
            OSError,
        ):
            with self._mutex:
                if claimed and pending["generation"] == self._generation:
                    self._last_error = "ChatGPT sign-in could not be verified. Try again."
            return False
        finally:
            with self._mutex:
                if claimed and self._pending is pending:
                    self._pending = None

    @staticmethod
    def _apply_tokens(profile, tokens, *, initial=False):
        expiry = tokens.get("expires_in")
        if (
            type(expiry) not in (int, float)
            or not 0 < expiry <= 31 * 86400
            or tokens.get("token_type", "").lower() != "bearer"
        ):
            raise ValueError("Invalid access token lifetime")
        for name in ("access_token", "refresh_token"):
            token = tokens.get(name, profile.get(name) if not initial else None)
            if (
                not isinstance(token, str)
                or not token
                or len(token) > 32000
                or any(ord(c) < 33 or ord(c) > 126 for c in token)
            ):
                raise ValueError("Invalid credential")
            profile[name] = token
        scope = tokens.get("scope")
        if scope is not None:
            if not isinstance(scope, str) or len(scope) > 4096:
                raise ValueError("Invalid granted scopes")
            profile["scopes"] = scope.split()
        elif initial:
            profile["scopes"] = []
        profile["expires_at"] = time.time() + expiry

    def activate(self, profile_id):
        with self._locked():
            value = self._read()
            if profile_id not in value["profiles"]:
                raise auth_required()
            value["active"] = profile_id
            self._write(value)
        return self.status()

    def access_token(self, profile_id=None):
        try:
            with self._locked():
                value = self._read()
                profile = value["profiles"].get(profile_id or value["active"])
                if not profile or not self._connected(profile):
                    raise auth_required()
                if profile.get("expires_at", 0) <= time.time() + 60:
                    status, tokens = self._request(
                        "POST",
                        TOKEN,
                        data={
                            "grant_type": "refresh_token",
                            "client_id": profile["client_id"],
                            "refresh_token": profile["refresh_token"],
                            "resource": RESOURCE,
                        },
                    )
                    if not isinstance(tokens, dict):
                        raise ValueError("Invalid refresh result")
                    if tokens.get("error") in TERMINAL_REFRESH:
                        self._clear_tokens(profile)
                        self._write(value)
                        raise auth_required()
                    if status != 200:
                        raise ValueError("Refresh temporarily unavailable")
                    if tokens.get("id_token"):
                        claims = self._identity(tokens["id_token"], profile["client_id"])
                        if claims["sub"] != profile["subject"]:
                            raise ValueError("Refresh identity mismatch")
                        profile["id_token"] = tokens["id_token"]
                    self._apply_tokens(profile, tokens)
                    self._write(value)
                    if not self._connected(profile):
                        raise auth_required()
                return profile["access_token"]
        except (httpx.HTTPError, jwt.PyJWTError, ValueError, TypeError, KeyError, OSError):
            raise DomainError(
                "chatgpt_unavailable", "ChatGPT token renewal failed. Try again later.", 502
            ) from None

    def models(self, profile_id=None):
        selected = profile_id or self.status()["active_profile_id"]
        token = self.access_token(selected)
        try:
            value = self._json(
                "GET",
                RESOURCE + "/models",
                headers={"Authorization": "Bearer " + token},
                # The account catalog includes large model instruction fields. Bound
                # that endpoint separately and expose only the picker metadata below.
                maximum=2 * 1024 * 1024,
            )
            catalog = value.get("models")
            if not isinstance(catalog, list) or len(catalog) > 1000:
                raise ValueError("Invalid model catalog")
            models = []
            for model in catalog:
                if not isinstance(model, dict):
                    raise ValueError("Invalid model")
                if model.get("visibility") == "list":
                    slug, name = model.get("slug"), model.get("display_name")
                    if (
                        not isinstance(slug, str)
                        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", slug)
                        or not isinstance(name, str)
                        or not 1 <= len(name) <= 200
                    ):
                        raise ValueError("Invalid model metadata")
                    models.append({"id": slug, "name": name})
            return models
        except (httpx.HTTPError, ValueError, TypeError, KeyError):
            raise DomainError(
                "chatgpt_unavailable",
                "The selected ChatGPT account's model catalog is unavailable",
                502,
            ) from None

    @staticmethod
    def _clear_tokens(profile):
        for name in ("access_token", "refresh_token", "id_token", "expires_at"):
            profile.pop(name, None)

    def disconnect(self, profile_id=None):
        self.close()
        with self._locked():
            value = self._read()
            profile = value["profiles"].get(profile_id or value["active"])
            confirmed = False
            if profile:
                if profile.get("refresh_token"):
                    try:
                        endpoint = self._trusted_endpoint(
                            self._metadata().get("revocation_endpoint")
                        )
                        for attempt in range(2):
                            try:
                                status, _ = self._request(
                                    "POST",
                                    endpoint,
                                    data={
                                        "token": profile["refresh_token"],
                                        "token_type_hint": "refresh_token",
                                        "client_id": profile["client_id"],
                                    },
                                )
                            except httpx.HTTPError:
                                status = 503
                            if status == 200:
                                confirmed = True
                                break
                            if status < 500:
                                break
                            if attempt == 0:
                                time.sleep(0.1)
                    except (httpx.HTTPError, ValueError, TypeError):
                        pass
                self._clear_tokens(profile)
                self._write(value)
            self._revocation_confirmed = confirmed
            self._last_error = (
                None
                if confirmed
                else "Signed out locally. Remote revocation was not confirmed; disconnect Arcloom in ChatGPT Settings."
            )
        return self.status()

    def close(self):
        with self._mutex:
            self._generation += 1
            self._pending = None
            thread = self._thread
            self._thread = None
        if thread and thread is not threading.current_thread():
            thread.join(timeout=2.5)
