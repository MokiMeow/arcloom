"""Typed public contracts. Agents never receive a general command or URL tool."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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


class LoginInput(StrictModel):
    token: str = Field(min_length=32, max_length=256)


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
