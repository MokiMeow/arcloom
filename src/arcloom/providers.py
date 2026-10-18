"""Explicit local provider profiles, immutable run settings and bounded diagnostics.

The private overlay has the same local trust boundary as .env. It is never an
API response or audit payload. Only the environment's explicitly selected
provider can bootstrap a credential; keys are never classified by their prefix.
"""

import json
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, ValidationError, field_validator

from arcloom.agents import DeterministicPlanner, ModelPlanner, check_selection
from arcloom.auth import require
from arcloom.clef import ClefPlanner
from arcloom.cloudflare_auth import CloudflareAuthError, credentials
from arcloom.config import Settings
from arcloom.domain import Actor, Candidate, DomainError, Role, StrictModel
from arcloom.storage import Store, canonical, new_id, row_or_error

ProviderID = Literal["deterministic", "openai", "anthropic", "gemini", "cloudflare", "chatgpt"]
LABELS = {
    "deterministic": "Deterministic graph ranking",
    "openai": "OpenAI API",
    "anthropic": "Anthropic API",
    "gemini": "Google Gemini API",
    "cloudflare": "Cloudflare Workers AI",
    "chatgpt": "ChatGPT subscription",
}


class ProviderInput(StrictModel):
    provider: ProviderID
    model: str = Field(default="", max_length=160, pattern=r"^[A-Za-z0-9@/._:-]*$")
    api_key: str | None = Field(default=None, max_length=4096)
    account_id: str | None = Field(default=None, max_length=64)
    profile_id: str | None = Field(default=None, max_length=80, pattern=r"^[A-Za-z0-9_-]*$")

    @field_validator("api_key", mode="before")
    @classmethod
    def valid_header_credential(cls, value):
        if isinstance(value, str) and any(ord(char) < 32 or ord(char) > 126 for char in value):
            raise ValueError("API credentials must contain only printable ASCII characters")
        return value


class ChatGPTProfileInput(StrictModel):
    profile_id: str | None = Field(default=None, max_length=80, pattern=r"^[A-Za-z0-9_-]*$")


class ProviderManager:
    def __init__(self, settings: Settings, store: Store, chatgpt=None, planner_factory=None):
        self.settings, self.store, self.chatgpt = settings, store, chatgpt
        self.planner_factory = planner_factory
        self.path = settings.data_dir / "private" / "providers.json"
        self._lock = threading.RLock()

    def _load(self) -> dict:
        if self.path.exists():
            try:
                state = json.loads(self.path.read_text(encoding="utf-8"))
                if (
                    state.get("version") != 1
                    or state.get("active_provider") not in LABELS
                    or not isinstance(state.get("profiles"), dict)
                ):
                    raise ValueError("Invalid local provider configuration")
                for provider, profile in state["profiles"].items():
                    if provider not in LABELS or not isinstance(profile, dict):
                        raise ValueError("Invalid local provider profile")
                return state
            except (OSError, ValueError, TypeError) as exc:
                raise DomainError(
                    "provider_configuration",
                    "The private provider configuration could not be read",
                    503,
                ) from exc
        provider = self.settings.provider
        return {
            "version": 1,
            "active_provider": provider,
            "profiles": {
                provider: {
                    "model": self.settings.model,
                    "credential_source": "environment",
                    "profile_id": self.settings.chatgpt_profile_id if provider == "chatgpt" else "",
                }
            },
        }

    def _credential(self, provider: str, profile: dict) -> str:
        if profile.get("credential_source") == "environment":
            # The environment owns this credential. Refreshing .env and
            # restarting must not leave an old copied token in the overlay.
            if provider == self.settings.provider and provider not in {"deterministic", "chatgpt"}:
                return self.settings.model_api_key.get_secret_value()
            return ""
        # Earlier overlays without a source represent explicitly saved keys.
        return profile.get("api_key", "")

    def _account(self, provider: str, profile: dict) -> str:
        if profile.get("credential_source") == "environment":
            return (
                self.settings.cloudflare_account_id
                if provider == self.settings.provider == "cloudflare"
                else ""
            )
        return profile.get("account_id", "")

    def _save(self, state: dict):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = None
        try:
            fd, temporary = tempfile.mkstemp(prefix=".providers-", dir=self.path.parent)
            os.chmod(temporary, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                stream.write(canonical(state))
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            os.chmod(self.path, 0o600)
        except OSError as exc:
            raise DomainError(
                "provider_configuration",
                "The private provider configuration could not be saved",
                503,
            ) from exc
        finally:
            if temporary and Path(temporary).exists():
                Path(temporary).unlink()

    def _settings(self, state: dict) -> Settings:
        provider = state["active_provider"]
        profile = state["profiles"].get(provider, {})
        values = self.settings.model_dump()
        values.update(
            provider=provider,
            model=profile.get("model", ""),
            model_api_key=self._credential(provider, profile),
            cloudflare_account_id=self._account(provider, profile),
            chatgpt_profile_id=profile.get("profile_id", ""),
        )
        try:
            return Settings.model_validate(values)
        except ValidationError as exc:
            raise DomainError(
                "provider_configuration",
                "A valid model ID, API key and matching account are required for this provider",
                422,
            ) from exc

    def snapshot(self) -> Settings:
        with self._lock:
            state = self._load()
            snapshot = (
                self._settings(state) if self.path.exists() else self.settings.model_copy(deep=True)
            )
            snapshot._cloudflare_environment_credential = (
                snapshot.provider == self.settings.provider == "cloudflare"
                and state["profiles"].get("cloudflare", {}).get("credential_source")
                == "environment"
            )
            if snapshot.provider == "chatgpt" and not snapshot.chatgpt_profile_id and self.chatgpt:
                snapshot.chatgpt_profile_id = self.chatgpt.status().get("active_profile_id") or ""
            return snapshot

    def status(self) -> dict:
        with self._lock:
            state = self._load()
            chatgpt = (
                self.chatgpt.status()
                if self.chatgpt
                else {
                    "connected": False,
                    "active_profile_id": None,
                    "profiles": [],
                    "pending": False,
                }
            )
            profiles = []
            for provider, label in LABELS.items():
                saved = state["profiles"].get(provider, {})
                profile_id = (
                    (saved.get("profile_id") or chatgpt.get("active_profile_id") or "")
                    if provider == "chatgpt"
                    else ""
                )
                profile_connected = any(
                    profile["id"] == profile_id and profile["connected"]
                    for profile in chatgpt["profiles"]
                )
                profiles.append(
                    {
                        "id": provider,
                        "label": label,
                        "model": saved.get("model", ""),
                        "key_configured": bool(self._credential(provider, saved)),
                        "account_id": self._account(provider, saved),
                        "profile_id": profile_id,
                        "connected": profile_connected
                        if provider == "chatgpt"
                        else provider == "deterministic" or bool(self._credential(provider, saved)),
                    }
                )
            return {
                "active_provider": state["active_provider"],
                "providers": profiles,
                "chatgpt": chatgpt,
                "available_providers": [
                    {"id": provider, "label": label} for provider, label in LABELS.items()
                ],
            }

    def configure(self, actor: Actor, **values) -> dict:
        require(actor, Role.ADMIN)
        value = ProviderInput.model_validate(values)
        owner = new_id("provider_config")
        lease = "provider_config"
        if not self.store.acquire_lock(lease, owner, 10):
            raise DomainError(
                "provider_busy", "Another provider configuration update is running", 409
            )
        try:
            with self._lock:
                state = self._load()
                saved = dict(state["profiles"].get(value.provider, {}))
                saved["model"] = value.model
                if value.api_key:
                    saved["api_key"] = value.api_key
                    saved["credential_source"] = "saved"
                    # A key submitted for the current environment provider may
                    # reuse that provider's account, never another provider's.
                    if "account_id" not in saved and value.provider == self.settings.provider:
                        saved["account_id"] = (
                            self.settings.cloudflare_account_id
                            if value.provider == "cloudflare"
                            else ""
                        )
                if value.account_id is not None:
                    saved["account_id"] = value.account_id
                if value.profile_id is not None:
                    saved["profile_id"] = value.profile_id
                if value.provider in {"chatgpt", "deterministic"}:
                    saved["api_key"] = ""
                if saved.get("credential_source") == "environment":
                    saved.pop("api_key", None)
                    saved.pop("account_id", None)
                state["profiles"][value.provider] = saved
                state["active_provider"] = value.provider
                self._settings(state)  # Validate before persisting or changing account state.
                if value.provider == "chatgpt" and saved.get("profile_id"):
                    if not self.chatgpt:
                        raise DomainError(
                            "chatgpt_unavailable", "ChatGPT authentication is unavailable", 503
                        )
                    self.chatgpt.activate(saved["profile_id"])
                self._save(state)
                self.audit(
                    actor, "provider.configured", {"provider": value.provider, "model": value.model}
                )
                return self.status()
        finally:
            self.store.release_lock(lease, owner)

    def planner(self, settings: Settings):
        return self.planning_snapshot(settings)[1]

    def _planner(self, settings: Settings):
        if settings.provider == "chatgpt" and (
            not settings.model or not settings.chatgpt_profile_id
        ):
            raise DomainError(
                "provider_configuration",
                "Connect a ChatGPT account and select its model before inference",
                409,
            )
        if self.planner_factory:
            return self.planner_factory(settings)
        if settings.provider == "deterministic":
            return DeterministicPlanner()
        if settings.provider == "cloudflare":
            return ClefPlanner(settings)
        if settings.provider == "chatgpt":
            from arcloom.chatgpt_planner import ChatGPTPlanner

            return ChatGPTPlanner(settings, self.chatgpt)
        return ModelPlanner(settings)

    def planning_snapshot(self, captured: Settings | None = None):
        # Refresh only when constructing a real planner, never on status reads.
        # The caller's captured selection and credential remain immutable.
        settings = captured.model_copy(deep=True) if captured is not None else self.snapshot()
        until = settings.cloudflare_wrangler_until
        if (
            settings.provider == self.settings.provider == "cloudflare"
            and settings._cloudflare_environment_credential
            and until is not None
            and time.time() < until <= time.time() + 4 * 86400
            and not any(key.upper() == "ARCLOOM_MODEL_API_KEY" for key in os.environ)
        ):
            started = time.monotonic()
            planning_deadline = started + settings.model_timeout_seconds
            failed = False
            try:
                _, token = credentials(timeout=settings.model_timeout_seconds)
            except CloudflareAuthError:
                failed = True
            if failed:
                # No upstream exception, stdout or credential remains in a chain.
                raise DomainError(
                    "cloudflare_credentials",
                    "Cloudflare credential renewal failed. Check the existing Wrangler session; "
                    "no fallback was used.",
                    503,
                )
            remaining = planning_deadline - time.monotonic()
            if remaining <= 0:
                raise DomainError(
                    "model_timeout",
                    "Cloudflare credential renewal exhausted the planning timeout",
                    504,
                )
            settings = settings.model_copy(
                update={"model_api_key": SecretStr(token), "model_timeout_seconds": remaining},
                deep=True,
            )
            settings._model_deadline = planning_deadline
        return settings, self._planner(settings)

    def audit(self, actor: Actor, kind: str, payload: dict, object_id="provider"):
        with self.store.transaction() as conn:
            self.store.event(conn, actor.tenant, kind, actor.id, object_id, payload)

    def test(self, actor: Actor) -> dict:
        require(actor, Role.ADMIN)
        self.store.limit("provider_test_" + actor.tenant, 10, 60)
        owner, lease = new_id("diagnostic"), "provider_test_" + actor.tenant
        if not self.store.acquire_lock(lease, owner, 90):
            raise DomainError("provider_busy", "A provider diagnostic is already running", 409)
        try:
            settings, planner = self.planning_snapshot()
            with self.store.transaction() as conn:
                tenant = row_or_error(
                    conn, "SELECT revision FROM tenants WHERE id=?", (actor.tenant,)
                )
                if settings.provider != "deterministic":
                    budget = row_or_error(
                        conn,
                        "SELECT model_calls FROM budgets WHERE tenant=? AND revision=?",
                        (actor.tenant, tenant["revision"]),
                    )
                    if budget["model_calls"] >= settings.model_call_budget:
                        raise DomainError("model_budget", "The model-call budget is exhausted", 403)
                    conn.execute(
                        "UPDATE budgets SET model_calls=model_calls+1 WHERE tenant=? AND revision=?",
                        (actor.tenant, tenant["revision"]),
                    )
            result = {
                "diagnostic": True,
                "provider": settings.provider,
                "model": settings.model or "graph-rank-v1",
                "input_tokens": 0,
                "output_tokens": 0,
            }
            candidate = Candidate(
                "diagnostic_boundary",
                "synthetic_fixture",
                "Diagnostic synthetic boundary check",
                ("synthetic_prerequisite",),
                ("diagnostic_support",),
                10,
                1,
                (),
            )
            try:
                plan = planner.select([candidate])
                if plan.selection is not None:
                    selected = check_selection(plan.selection, [candidate])
                    result.update(
                        status="selected",
                        selection=selected.public(),
                        reason="The provider selected the offered synthetic diagnostic candidate. No investigation was created.",
                    )
                else:
                    result.update(
                        status="needs_review",
                        reason="The provider abstained on the synthetic diagnostic candidate. No investigation was created.",
                    )
                result.update(input_tokens=plan.input_tokens, output_tokens=plan.output_tokens)
                # Decisions contain only adapter-validated metadata; no upstream text is exposed.
                if settings.provider == "cloudflare":
                    result["decision"] = plan.decision
            except Exception as exc:
                result.update(
                    status="error",
                    error=exc.code if isinstance(exc, DomainError) else "provider_test_failed",
                    reason="The selected provider diagnostic failed. Check its account, model and credentials; no fallback was used.",
                )
            self.audit(
                actor,
                "provider.tested",
                {
                    key: result[key]
                    for key in ("provider", "model", "status", "input_tokens", "output_tokens")
                },
                owner,
            )
            return result
        finally:
            self.store.release_lock(lease, owner)
