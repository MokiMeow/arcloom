"""Argon2id accounts, high-entropy service tokens, sessions and workspace RBAC."""

import hashlib
import hmac
import secrets
import sqlite3
import time
from typing import Any

from arcloom.config import Settings
from arcloom.domain import Actor, DomainError, Role
from arcloom.graph import seed_graph
from arcloom.passwords import (
    PasswordHashBusyError,
    hash_password,
    needs_rehash,
    normalize_email,
    verify_password,
)
from arcloom.storage import Store, digest, new_id


def _hash_password(value: str) -> str:
    try:
        return hash_password(value)
    except PasswordHashBusyError:
        raise DomainError(
            "authentication_busy", "Authentication is busy. Try again shortly.", 503
        ) from None


def _verify_password(encoded: str | None, value: str) -> bool:
    try:
        return verify_password(encoded, value)
    except PasswordHashBusyError:
        raise DomainError(
            "authentication_busy", "Authentication is busy. Try again shortly.", 503
        ) from None


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
        with self.store.transaction() as conn:
            return self._new_session(conn, actor)

    def _new_session(self, conn: sqlite3.Connection, actor: Actor) -> tuple[Actor, str, str]:
        # Recheck under the write transaction so a concurrent revocation cannot issue a session.
        member = conn.execute(
            "SELECT role FROM members WHERE id=? AND tenant=? AND active=1",
            (actor.id, actor.tenant),
        ).fetchone()
        if member is None:
            raise DomainError("unauthorized", "Authentication required", 401)
        session, now = secrets.token_urlsafe(48), time.time()
        session_hash = digest(session)
        csrf = self.csrf_for_hash(session_hash)
        conn.execute("DELETE FROM sessions WHERE expires_at<?", (now,))
        conn.execute(
            "INSERT INTO sessions VALUES(?,?,?,?,?)",
            (session_hash, actor.id, digest(csrf), now + self.settings.session_seconds, now),
        )
        self.store.event(conn, actor.tenant, "session.created", actor.id, actor.id, {})
        return Actor(actor.id, actor.tenant, Role(member["role"]), session_hash), session, csrf

    def register(self, name: str, email: str, password: str) -> tuple[Actor, str, str, str]:
        """Create an empty private workspace and its owner in one journal transaction."""
        name = name.strip()
        if not 2 <= len(name) <= 80 or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise DomainError("invalid_account", "Enter a name containing 2–80 characters", 422)
        try:
            email = normalize_email(email)
            encoded = _hash_password(password)
        except ValueError as error:
            raise DomainError("invalid_account", str(error), 422) from None
        tenant, member_id = new_id("workspace"), new_id("member")
        recovery_code = self._recovery_code()
        actor, now = Actor(member_id, tenant, Role.ADMIN), time.time()
        try:
            with self.store.transaction() as conn:
                conn.execute("INSERT INTO tenants VALUES(?,?,1,?)", (tenant, "r1", now))
                # A password account has no bearer token unless one is separately provisioned.
                conn.execute(
                    "INSERT INTO members VALUES(?,?,?,?,?,1,?)",
                    (member_id, tenant, name, Role.ADMIN, digest(secrets.token_urlsafe(48)), now),
                )
                conn.execute(
                    "INSERT INTO accounts VALUES(?,?,?,?,?)",
                    (member_id, email, encoded, digest(recovery_code), now),
                )
                conn.execute("INSERT INTO budgets(tenant,revision) VALUES(?,?)", (tenant, "r1"))
                self.store.event(
                    conn,
                    tenant,
                    "workspace.initialized",
                    "system",
                    tenant,
                    {"catalog_version": "1", "synthetic": True},
                    seed_graph(),
                )
                self.store.event(
                    conn,
                    tenant,
                    "account.registered",
                    member_id,
                    member_id,
                    {"password_scheme": "argon2id"},
                )
                actor, session, csrf = self._new_session(conn, actor)
        except sqlite3.IntegrityError:
            if self.store.one("SELECT member_id FROM accounts WHERE email=?", (email,)):
                raise DomainError(
                    "account_unavailable", "An account cannot be created with these details", 409
                ) from None
            raise
        return actor, session, csrf, recovery_code

    def login_password(self, email: str, password: str) -> tuple[Actor, str, str]:
        try:
            email = normalize_email(email)
        except ValueError:
            # Invalid and unknown addresses use the same password-work path and response.
            email = ""
        row = self.store.one(
            "SELECT m.*,a.password_hash FROM accounts a JOIN members m ON m.id=a.member_id "
            "WHERE a.email=?",
            (email,),
        )
        valid = _verify_password(row["password_hash"] if row else None, password)
        if not valid or row is None or not row["active"]:
            raise DomainError("unauthorized", "Email or password is incorrect", 401)
        upgraded = _hash_password(password) if needs_rehash(row["password_hash"]) else None
        actor = Actor(row["id"], row["tenant"], Role(row["role"]))
        with self.store.transaction() as conn:
            # A password reset between verification and issuance must invalidate this login.
            current = conn.execute(
                "SELECT password_hash FROM accounts WHERE member_id=?", (actor.id,)
            ).fetchone()
            if current is None or not hmac.compare_digest(
                current["password_hash"], row["password_hash"]
            ):
                raise DomainError("unauthorized", "Email or password is incorrect", 401)
            if upgraded:
                conn.execute(
                    "UPDATE accounts SET password_hash=? WHERE member_id=?", (upgraded, actor.id)
                )
            return self._new_session(conn, actor)

    def public_actor(self, actor: Actor) -> dict[str, Any]:
        row = self.store.one(
            "SELECT m.name,a.email FROM members m LEFT JOIN accounts a ON a.member_id=m.id "
            "WHERE m.id=? AND m.tenant=? AND m.active=1",
            (actor.id, actor.tenant),
        )
        if row is None:
            raise DomainError("unauthorized", "Authentication required", 401)
        return {
            "id": actor.id,
            "tenant": actor.tenant,
            "role": actor.role,
            "name": row["name"],
            "email": row["email"],
            "password_account": row["email"] is not None,
        }

    @staticmethod
    def _recovery_code() -> str:
        # High-entropy, single-use recovery credentials are hashed like bearer tokens.
        return "arc-recovery-" + secrets.token_urlsafe(32)

    def recover(
        self, email: str, recovery_code: str, new_password: str
    ) -> tuple[Actor, str, str, str]:
        try:
            email = normalize_email(email)
        except ValueError:
            email = ""
        row = self.store.one(
            "SELECT m.*,a.recovery_hash FROM accounts a JOIN members m ON m.id=a.member_id "
            "WHERE a.email=?",
            (email,),
        )
        supplied_hash = digest(recovery_code.strip())
        valid = hmac.compare_digest(row["recovery_hash"] if row else "0" * 64, supplied_hash)
        if not valid or row is None or not row["active"]:
            raise DomainError("unauthorized", "Email or recovery code is incorrect", 401)
        try:
            encoded = _hash_password(new_password)
        except ValueError as error:
            raise DomainError("invalid_password", str(error), 422) from None
        new_code = self._recovery_code()
        actor, now = Actor(row["id"], row["tenant"], Role(row["role"])), time.time()
        with self.store.transaction() as conn:
            changed = conn.execute(
                "UPDATE accounts SET password_hash=?,recovery_hash=?,password_changed_at=? "
                "WHERE member_id=? AND recovery_hash=?",
                (encoded, digest(new_code), now, actor.id, row["recovery_hash"]),
            )
            if not changed.rowcount:
                raise DomainError("unauthorized", "Email or recovery code is incorrect", 401)
            conn.execute("DELETE FROM sessions WHERE member_id=?", (actor.id,))
            self.store.event(conn, actor.tenant, "account.recovered", actor.id, actor.id, {})
            actor, session, csrf = self._new_session(conn, actor)
        return actor, session, csrf, new_code

    def change_password(
        self, actor: Actor, current_password: str, new_password: str
    ) -> tuple[Actor, str, str]:
        row = self.store.one(
            "SELECT a.password_hash FROM accounts a JOIN members m ON m.id=a.member_id "
            "WHERE m.id=? AND m.tenant=? AND m.active=1",
            (actor.id, actor.tenant),
        )
        valid = _verify_password(row["password_hash"] if row else None, current_password)
        if not valid or row is None:
            raise DomainError("invalid_credentials", "Current password is incorrect", 401)
        try:
            encoded = _hash_password(new_password)
        except ValueError as error:
            raise DomainError("invalid_password", str(error), 422) from None
        with self.store.transaction() as conn:
            changed = conn.execute(
                "UPDATE accounts SET password_hash=?,password_changed_at=? "
                "WHERE member_id=? AND password_hash=?",
                (encoded, time.time(), actor.id, row["password_hash"]),
            )
            if not changed.rowcount:
                raise DomainError("invalid_credentials", "Current password is incorrect", 401)
            conn.execute("DELETE FROM sessions WHERE member_id=?", (actor.id,))
            self.store.event(conn, actor.tenant, "account.password_changed", actor.id, actor.id, {})
            return self._new_session(conn, actor)

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
