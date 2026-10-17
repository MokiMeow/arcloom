"""High-entropy access tokens, server-side sessions, CSRF and workspace-bound RBAC."""

import hashlib
import hmac
import secrets
import time
from typing import Any

from arcloom.config import Settings
from arcloom.domain import Actor, DomainError, Role
from arcloom.storage import Store, digest, new_id


class Auth:
    def __init__(self, store: Store, settings: Settings):
        self.store, self.settings = store, settings

    def bootstrap(self) -> bool:
        token = self.settings.admin_token.get_secret_value()
        if len(token) < 32:
            raise RuntimeError(
                "Set ARCLOOM_ADMIN_TOKEN to a random 32+ character token. Run scripts/configure.py."
            )
        now, tenant = time.time(), self.settings.tenant
        with self.store.transaction() as conn:
            fresh = conn.execute("SELECT id FROM tenants WHERE id=?", (tenant,)).fetchone() is None
            conn.execute("INSERT OR IGNORE INTO tenants VALUES(?,?,1,?)", (tenant, "r1", now))
            member_id = f"admin_{digest(tenant)[:16]}"
            previous = conn.execute(
                "SELECT token_hash FROM members WHERE id=?", (member_id,)
            ).fetchone()
            if previous and previous["token_hash"] != digest(token):
                conn.execute("DELETE FROM sessions WHERE member_id=?", (member_id,))
            conn.execute(
                "INSERT INTO members(id,tenant,name,role,token_hash,active,created_at) VALUES(?,?,?,?,?,1,?) "
                "ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,active=1",
                (member_id, tenant, "Workspace owner", Role.ADMIN, digest(token), now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO budgets(tenant,revision) VALUES(?,?)", (tenant, "r1")
            )
        return fresh

    def bearer(self, token: str) -> Actor:
        if len(token) < 32 or len(token) > 256:
            raise DomainError("unauthorized", "Authentication required", 401)
        row = self.store.one(
            "SELECT * FROM members WHERE token_hash=? AND active=1", (digest(token),)
        )
        if row is None:
            raise DomainError("unauthorized", "Authentication required", 401)
        return Actor(row["id"], row["tenant"], Role(row["role"]))

    def session(self, token: str, csrf: str | None = None, mutate: bool = False) -> Actor:
        if len(token) < 32 or len(token) > 256:
            raise DomainError("unauthorized", "Session expired", 401)
        row = self.store.one(
            "SELECT m.*,s.csrf_hash,s.expires_at FROM sessions s JOIN members m ON m.id=s.member_id "
            "WHERE s.token_hash=? AND m.active=1",
            (digest(token),),
        )
        if row is None or row["expires_at"] <= time.time():
            raise DomainError("unauthorized", "Session expired", 401)
        if mutate and (not csrf or not hmac.compare_digest(row["csrf_hash"], digest(csrf))):
            raise DomainError("csrf", "A valid CSRF token is required", 403)
        return Actor(row["id"], row["tenant"], Role(row["role"]), digest(token))

    def login(self, token: str) -> tuple[Actor, str, str]:
        actor = self.bearer(token)
        session, now = secrets.token_urlsafe(48), time.time()
        csrf = self.csrf_for_hash(digest(session))
        with self.store.transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE expires_at<?", (now,))
            conn.execute(
                "INSERT INTO sessions VALUES(?,?,?,?,?)",
                (digest(session), actor.id, digest(csrf), now + self.settings.session_seconds, now),
            )
            self.store.event(conn, actor.tenant, "session.created", actor.id, actor.id, {})
        return actor, session, csrf

    def csrf_for_hash(self, session_hash: str) -> str:
        return hmac.new(
            self.settings.admin_token.get_secret_value().encode(),
            ("arcloom-csrf:" + session_hash).encode(),
            hashlib.sha256,
        ).hexdigest()

    def logout(self, actor: Actor) -> None:
        with self.store.transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash=?", (actor.session_hash or "",))
            self.store.event(conn, actor.tenant, "session.revoked", actor.id, actor.id, {})

    def add_member(self, actor: Actor, name: str, role: Role) -> dict[str, Any]:
        require(actor, Role.ADMIN)
        token, member_id = secrets.token_urlsafe(48), new_id("member")
        with self.store.transaction() as conn:
            conn.execute(
                "INSERT INTO members VALUES(?,?,?,?,?,1,?)",
                (member_id, actor.tenant, name, role, digest(token), time.time()),
            )
            self.store.event(
                conn, actor.tenant, "member.created", actor.id, member_id, {"role": role}
            )
        return {
            "id": member_id,
            "name": name,
            "role": role,
            "token": token,
            "notice": "Shown once. Store securely; this token is not recoverable from the API.",
        }

    def revoke_member(self, actor: Actor, member_id: str) -> None:
        require(actor, Role.ADMIN)
        if member_id == actor.id or member_id.startswith("admin_"):
            raise DomainError("protected_member", "The bootstrap owner cannot be revoked here", 403)
        with self.store.transaction() as conn:
            changed = conn.execute(
                "UPDATE members SET active=0 WHERE tenant=? AND id=?", (actor.tenant, member_id)
            )
            if not changed.rowcount:
                raise DomainError("not_found", "Member not found", 404)
            conn.execute("DELETE FROM sessions WHERE member_id=?", (member_id,))
            self.store.event(conn, actor.tenant, "member.revoked", actor.id, member_id, {})


def require(actor: Actor, *roles: Role) -> None:
    if actor.role != Role.ADMIN and actor.role not in roles:
        raise DomainError("forbidden", "Your role cannot perform this operation", 403)
