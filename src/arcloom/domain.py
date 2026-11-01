"""Typed public contracts. Agents never receive a general command or URL tool."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from arcloom.passwords import normalize_email, validate_password

Identifier = Annotated[str, Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")]


class State(StrEnum):
    AWAITING_APPROVAL = "awaiting_approval"
    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_REVIEW = "awaiting_review"
    CONFIRMED = "confirmed"
    NOT_REPRODUCED = "not_reproduced"
    INCONCLUSIVE = "inconclusive"
    REJECTED = "rejected"
    DENIED = "denied"


class Outcome(StrEnum):
    REPRODUCED = "reproduced"
    NOT_REPRODUCED = "not_reproduced"
    INCONCLUSIVE = "inconclusive"


class Role(StrEnum):
    ADMIN = "admin"
    REVIEWER = "reviewer"
    RESEARCHER = "researcher"
    VIEWER = "viewer"


@dataclass(frozen=True)
class Actor:
    id: str
    tenant: str
    role: Role
    session_hash: str | None = None


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ReportInput(StrictModel):
    title: str = Field(min_length=5, max_length=160)
    description: str = Field(min_length=10, max_length=8000)
    researcher: str = Field(min_length=2, max_length=100)
    asset_id: Identifier
    test_id: Identifier

    @field_validator("title", "description", "researcher")
    @classmethod
    def no_control_characters(cls, value: str) -> str:
        if any(ord(c) < 32 and c not in "\n\t" for c in value):
            raise ValueError("Control characters are not accepted")
        return value


class ApprovalInput(StrictModel):
    decision: Literal["approve", "deny"]
    reason: str = Field(min_length=5, max_length=1000)


class ReviewInput(StrictModel):
    decision: Literal["accept", "reject", "needs_info"]
    reason: str = Field(min_length=5, max_length=1000)


class DiscoveryInput(StrictModel):
    source_finding_id: Identifier | None = None


class RevisionInput(StrictModel):
    revision: Literal["r1", "r2"]
    reason: str = Field(min_length=5, max_length=1000)


class ScopeInput(StrictModel):
    enabled: bool
    reason: str = Field(min_length=5, max_length=1000)


class AccountInput(StrictModel):
    # Password and recovery values must never inherit StrictModel's whitespace trimming.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    @field_validator("email", check_fields=False)
    @classmethod
    def canonical_email(cls, value: str | None) -> str | None:
        return normalize_email(value) if value is not None else None


class LoginInput(AccountInput):
    token: str | None = Field(default=None, min_length=32, max_length=256)
    email: str | None = Field(default=None, min_length=3, max_length=254)
    password: SecretStr | None = Field(default=None, min_length=1, max_length=128)

    @field_validator("token", mode="before")
    @classmethod
    def copied_access_token(cls, value):
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def one_login_method(self):
        token_login = self.token is not None and self.email is None and self.password is None
        password_login = self.token is None and self.email is not None and self.password is not None
        if not token_login and not password_login:
            raise ValueError("Use an email and password, or a workspace access token")
        return self


class RegisterInput(AccountInput):
    name: str = Field(min_length=2, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: SecretStr = Field(min_length=12, max_length=128)

    @field_validator("name")
    @classmethod
    def display_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Enter a name containing 2–80 characters")
        return value

    @field_validator("password")
    @classmethod
    def password_policy(cls, value: SecretStr) -> SecretStr:
        validate_password(value.get_secret_value())
        return value


class RecoverInput(AccountInput):
    email: str = Field(min_length=3, max_length=254)
    recovery_code: SecretStr = Field(min_length=32, max_length=256)
    new_password: SecretStr = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_policy(cls, value: SecretStr) -> SecretStr:
        validate_password(value.get_secret_value())
        return value


class PasswordChangeInput(AccountInput):
    current_password: SecretStr = Field(min_length=1, max_length=128)
    new_password: SecretStr = Field(min_length=12, max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_policy(cls, value: SecretStr) -> SecretStr:
        validate_password(value.get_secret_value())
        return value


class MemberInput(StrictModel):
    name: str = Field(min_length=2, max_length=60)
    role: Role


class Selection(StrictModel):
    candidate_id: Identifier
    reason: str = Field(min_length=5, max_length=1200)
    evidence_ids: list[Identifier] = Field(min_length=1, max_length=10)


@dataclass(frozen=True)
class Candidate:
    test_id: str
    asset_id: str
    title: str
    requirements: tuple[str, ...]
    finding_ids: tuple[str, ...]
    score: int
    depth: int
    path: tuple[dict[str, str], ...]

    def public(self) -> dict[str, Any]:
        return {
            "id": self.test_id,
            "test_id": self.test_id,
            "asset_id": self.asset_id,
            "title": self.title,
            "requirements": list(self.requirements),
            "finding_ids": list(self.finding_ids),
            "score": self.score,
            "depth": self.depth,
            "path": list(self.path),
        }


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)
