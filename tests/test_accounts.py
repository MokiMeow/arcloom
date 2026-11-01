"""Individual account credentials, recovery, session revocation and tenant isolation."""

import json
from concurrent.futures import ThreadPoolExecutor

import pytest
from pydantic import ValidationError

from arcloom.auth import Auth
from arcloom.config import Settings
from arcloom.domain import (
    DomainError,
    LoginInput,
    PasswordChangeInput,
    RecoverInput,
    RegisterInput,
    Role,
)
from arcloom.passwords import normalize_email, verify_password
from arcloom.storage import Store, canonical, digest

PASSWORD = "a sufficiently long account password"
NEW_PASSWORD = "a different sufficiently long password"
OWNER_TOKEN = "test-account-owner-" + "o" * 48


@pytest.fixture
def auth(tmp_path):
    settings = Settings(
        _env_file=None,
        data_dir=tmp_path,
        admin_token=OWNER_TOKEN,
        runner_secret="test-runner-" + "r" * 48,
        worker_enabled=False,
    )
    instance = Auth(Store(tmp_path), settings)
    instance.bootstrap()
    return instance


def create(auth, email="investigator@example.com", password=PASSWORD):
    return auth.register("Independent investigator", email, password)


def rejected(code, operation):
    with pytest.raises(DomainError) as error:
        operation()
    assert error.value.code == code
    return error.value


def test_signup_creates_private_empty_workspace_with_atomic_seed_and_session(auth):
    actor, session, csrf, recovery = create(auth)
    assert actor.role == Role.ADMIN
    assert actor.tenant != auth.settings.tenant
    assert auth.session(session, csrf, mutate=True) == actor
    assert auth.store.one("SELECT revision FROM tenants WHERE id=?", (actor.tenant,)) == {
        "revision": "r1"
    }
    budget = auth.store.one("SELECT * FROM budgets WHERE tenant=?", (actor.tenant,))
    assert budget["executions"] == budget["model_calls"] == 0
    assert auth.store.all("SELECT * FROM cases WHERE tenant=?", (actor.tenant,)) == []
    assert auth.store.all("SELECT * FROM findings WHERE tenant=?", (actor.tenant,)) == []
    events = auth.store.all("SELECT * FROM events WHERE tenant=? ORDER BY seq", (actor.tenant,))
    assert [event["kind"] for event in events] == [
        "workspace.initialized",
        "account.registered",
        "session.created",
    ]
    outbox = auth.store.all("SELECT * FROM outbox WHERE tenant=?", (actor.tenant,))
    assert len(outbox) == 1
    projection = json.loads(outbox[0]["payload"])
    assert {node["kind"] for node in projection["nodes"]} <= {
        "Asset",
        "TestCase",
        "Capability",
        "TrustBoundary",
        "Revision",
    }
    assert not {"Finding", "Report", "AgentSession"} & {
        node["kind"] for node in projection["nodes"]
    }
    assert auth.store.verify_audit(actor.tenant)["valid"]
    assert recovery.startswith("arc-recovery-") and len(recovery) >= 43


def test_passwords_are_salted_argon2id_and_secret_values_never_enter_journal(auth):
    first, session, csrf, recovery = create(auth)
    second, _, _, _ = create(auth, "another@example.com")
    first_row = auth.store.one("SELECT * FROM accounts WHERE member_id=?", (first.id,))
    second_row = auth.store.one("SELECT * FROM accounts WHERE member_id=?", (second.id,))
    assert first_row["password_hash"].startswith("$argon2id$v=19$m=65536,t=3,p=4$")
    assert first_row["password_hash"] != second_row["password_hash"]
    assert verify_password(first_row["password_hash"], PASSWORD)
    assert first_row["recovery_hash"] == digest(recovery)
    assert auth.store.one("SELECT token_hash FROM sessions WHERE member_id=?", (first.id,))[
        "token_hash"
    ] == digest(session)
    persisted = canonical(
        {
            table: auth.store.all("SELECT * FROM " + table)
            for table in ["accounts", "members", "sessions", "events", "outbox"]
        }
    )
    for credential in [PASSWORD, session, csrf, recovery]:
        assert credential not in persisted
    profile = auth.public_actor(first)
    assert profile == {
        "id": first.id,
        "tenant": first.tenant,
        "role": Role.ADMIN,
        "name": "Independent investigator",
        "email": "investigator@example.com",
        "password_account": True,
    }
    assert "hash" not in canonical(profile)


def test_email_canonicalization_login_and_duplicate_registration_have_no_orphans(auth):
    first, _, _, _ = create(auth, " Investigator@EXAMPLE.COM ")
    actor, token, csrf = auth.login_password("INVESTIGATOR@example.com", PASSWORD)
    assert actor.id == first.id
    assert auth.session(token, csrf, mutate=True).tenant == first.tenant
    before = {
        table: len(auth.store.all("SELECT * FROM " + table))
        for table in ["tenants", "members", "budgets", "accounts", "events", "outbox"]
    }
    rejected("account_unavailable", lambda: create(auth, "investigator@example.com"))
    after = {table: len(auth.store.all("SELECT * FROM " + table)) for table in before}
    assert after == before


def test_concurrent_duplicate_signup_commits_only_one_workspace(auth):
    def attempt():
        try:
            return create(auth, "same@example.com")[0]
        except DomainError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(lambda _: attempt(), range(2)))
    assert sum(value == "account_unavailable" for value in outcomes) == 1
    assert len(auth.store.all("SELECT * FROM accounts")) == 1
    assert len(auth.store.all("SELECT * FROM tenants")) == 2  # includes bootstrap workspace
    assert len(auth.store.all("SELECT * FROM members")) == 2


def test_signup_failure_rolls_back_all_account_workspace_and_audit_records(auth, monkeypatch):
    def unavailable(*_):
        raise RuntimeError("test session failure")

    monkeypatch.setattr(auth, "_new_session", unavailable)
    with pytest.raises(RuntimeError, match="test session failure"):
        create(auth)
    assert auth.store.all("SELECT * FROM accounts") == []
    assert len(auth.store.all("SELECT * FROM tenants")) == 1
    assert len(auth.store.all("SELECT * FROM members")) == 1
    assert len(auth.store.all("SELECT * FROM budgets")) == 1
    assert auth.store.all("SELECT * FROM events") == []
    assert auth.store.all("SELECT * FROM outbox") == []


def test_wrong_unknown_and_inactive_password_accounts_have_same_public_error(auth):
    actor, session, _, _ = create(auth)
    wrong = rejected(
        "unauthorized", lambda: auth.login_password("investigator@example.com", NEW_PASSWORD)
    )
    unknown = rejected("unauthorized", lambda: auth.login_password("missing@example.com", PASSWORD))
    invalid = rejected("unauthorized", lambda: auth.login_password("invalid-address", PASSWORD))
    with auth.store.transaction() as conn:
        conn.execute("UPDATE members SET active=0 WHERE id=?", (actor.id,))
    inactive = rejected(
        "unauthorized", lambda: auth.login_password("investigator@example.com", PASSWORD)
    )
    assert {(e.status, e.message) for e in [wrong, unknown, invalid, inactive]} == {
        (401, "Email or password is incorrect")
    }
    rejected("unauthorized", lambda: auth.session(session))


def test_successful_login_upgrades_older_argon2_parameters(auth):
    from argon2 import PasswordHasher

    actor, _, _, _ = create(auth)
    previous = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1).hash(PASSWORD)
    with auth.store.transaction() as conn:
        conn.execute("UPDATE accounts SET password_hash=? WHERE member_id=?", (previous, actor.id))
    assert auth.login_password("investigator@example.com", PASSWORD)[0].id == actor.id
    current = auth.store.one("SELECT password_hash FROM accounts WHERE member_id=?", (actor.id,))[
        "password_hash"
    ]
    assert current != previous and current.startswith("$argon2id$v=19$m=65536,t=3,p=4$")
    assert verify_password(current, PASSWORD)


def test_login_cannot_issue_session_after_password_was_changed_during_verification(
    auth, monkeypatch
):
    from arcloom import auth as auth_module
    from arcloom.passwords import hash_password

    actor, token, _, _ = create(auth)
    encoded = hash_password(NEW_PASSWORD)
    original = auth_module._verify_password

    def password_changed(encoded_password, supplied_password):
        result = original(encoded_password, supplied_password)
        with auth.store.transaction() as conn:
            conn.execute(
                "UPDATE accounts SET password_hash=? WHERE member_id=?", (encoded, actor.id)
            )
            conn.execute("DELETE FROM sessions WHERE member_id=?", (actor.id,))
        return result

    monkeypatch.setattr(auth_module, "_verify_password", password_changed)
    rejected("unauthorized", lambda: auth.login_password("investigator@example.com", PASSWORD))
    rejected("unauthorized", lambda: auth.session(token))
    assert auth.store.all("SELECT * FROM sessions WHERE member_id=?", (actor.id,)) == []


def test_password_account_session_requires_matching_csrf_and_respects_expiry(auth):
    actor, token, csrf, _ = create(auth)
    rejected("csrf", lambda: auth.session(token, mutate=True))
    rejected("csrf", lambda: auth.session(token, "incorrect", mutate=True))
    assert auth.session(token, csrf, mutate=True).id == actor.id
    with auth.store.transaction() as conn:
        conn.execute("UPDATE sessions SET expires_at=0 WHERE token_hash=?", (digest(token),))
    rejected("unauthorized", lambda: auth.session(token))


def test_individual_accounts_never_share_member_tenant_or_session(auth):
    first, first_token, first_csrf, _ = create(auth)
    second, second_token, second_csrf, _ = create(auth, "another@example.com")
    assert first.id != second.id and first.tenant != second.tenant
    assert first_token != second_token and first_csrf != second_csrf
    assert auth.session(first_token, first_csrf, mutate=True).tenant == first.tenant
    rejected("csrf", lambda: auth.session(first_token, second_csrf, mutate=True))
    auth.logout(first)
    rejected("unauthorized", lambda: auth.session(first_token))
    assert auth.session(second_token, second_csrf, mutate=True).tenant == second.tenant


def test_password_change_requires_proof_rotates_session_and_revokes_other_sessions(auth):
    actor, first_session, _, recovery = create(auth)
    _, second_session, _ = auth.login_password("investigator@example.com", PASSWORD)
    rejected(
        "invalid_credentials",
        lambda: auth.change_password(actor, NEW_PASSWORD, "new safe password"),
    )
    assert auth.session(first_session).id == actor.id
    fresh_actor, fresh_session, fresh_csrf = auth.change_password(actor, PASSWORD, NEW_PASSWORD)
    rejected("unauthorized", lambda: auth.session(first_session))
    rejected("unauthorized", lambda: auth.session(second_session))
    rejected("unauthorized", lambda: auth.login_password("investigator@example.com", PASSWORD))
    assert auth.session(fresh_session, fresh_csrf, mutate=True).id == fresh_actor.id
    assert auth.login_password("investigator@example.com", NEW_PASSWORD)[0].id == actor.id
    assert auth.store.one("SELECT recovery_hash FROM accounts WHERE member_id=?", (actor.id,))[
        "recovery_hash"
    ] == digest(recovery)


def test_recovery_code_is_single_use_rotated_and_invalidates_all_old_sessions(auth):
    actor, first_session, _, recovery = create(auth)
    _, second_session, _ = auth.login_password("investigator@example.com", PASSWORD)
    fresh_actor, token, csrf, next_code = auth.recover(
        "INVESTIGATOR@example.com", recovery, NEW_PASSWORD
    )
    assert fresh_actor.id == actor.id and fresh_actor.tenant == actor.tenant
    assert next_code != recovery
    assert auth.session(token, csrf, mutate=True).id == actor.id
    for old_session in [first_session, second_session]:
        rejected("unauthorized", lambda old_session=old_session: auth.session(old_session))
    rejected("unauthorized", lambda: auth.recover("investigator@example.com", recovery, PASSWORD))
    rejected("unauthorized", lambda: auth.login_password("investigator@example.com", PASSWORD))
    assert auth.login_password("investigator@example.com", NEW_PASSWORD)[0].id == actor.id
    assert auth.recover("investigator@example.com", next_code, PASSWORD)[0].id == actor.id
    assert auth.store.verify_audit(actor.tenant)["valid"]


def test_concurrent_recovery_can_consume_code_only_once(auth):
    actor, _, _, code = create(auth)

    def attempt():
        try:
            return auth.recover("investigator@example.com", code, NEW_PASSWORD)[0]
        except DomainError as error:
            return error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(lambda _: attempt(), range(2)))
    assert sum(value == "unauthorized" for value in outcomes) == 1
    assert len(auth.store.all("SELECT * FROM sessions WHERE member_id=?", (actor.id,))) == 1


def test_bad_unknown_or_revoked_recovery_cannot_change_any_password(auth):
    actor, token, _, code = create(auth)
    errors = [
        rejected("unauthorized", lambda: auth.recover("unknown@example.com", code, NEW_PASSWORD)),
        rejected(
            "unauthorized",
            lambda: auth.recover("investigator@example.com", "wrong recovery code", NEW_PASSWORD),
        ),
    ]
    assert auth.session(token).id == actor.id
    with auth.store.transaction() as conn:
        conn.execute("UPDATE members SET active=0 WHERE id=?", (actor.id,))
    errors.append(
        rejected(
            "unauthorized", lambda: auth.recover("investigator@example.com", code, NEW_PASSWORD)
        )
    )
    assert {(error.status, error.message) for error in errors} == {
        (401, "Email or recovery code is incorrect")
    }
    row = auth.store.one("SELECT password_hash FROM accounts WHERE member_id=?", (actor.id,))
    assert verify_password(row["password_hash"], PASSWORD)
    assert not verify_password(row["password_hash"], NEW_PASSWORD)


def test_password_change_cannot_cross_tenants_or_convert_service_token_members(auth):
    actor, _, _, _ = create(auth)
    owner = auth.bearer(OWNER_TOKEN)
    rejected("invalid_credentials", lambda: auth.change_password(owner, PASSWORD, NEW_PASSWORD))
    assert auth.login_password("investigator@example.com", PASSWORD)[0].id == actor.id


def test_saturated_password_pool_returns_retryable_error_without_creating_account(
    auth, monkeypatch
):
    from arcloom import passwords

    class BusyPool:
        def acquire(self, *, timeout):
            assert timeout <= 1
            return False

        def release(self):
            pytest.fail("An unacquired slot must not be released")

    monkeypatch.setattr(passwords, "_KDF_SLOTS", BusyPool())
    for operation in [
        lambda: create(auth),
        lambda: auth.login_password("unknown@example.com", PASSWORD),
    ]:
        error = rejected("authentication_busy", operation)
        assert error.status == 503
    assert auth.store.all("SELECT * FROM accounts") == []


def test_invalid_unicode_passwords_fail_without_echoing_credentials(auth):
    password = "private-password-" + "\ud800"
    error = rejected("invalid_account", lambda: create(auth, password=password))
    assert password not in error.message and "private-password" not in error.message
    assert not verify_password(None, password)


def test_legacy_token_login_and_owner_bootstrap_survive_account_schema_addition(auth):
    owner, token, csrf = auth.login(OWNER_TOKEN)
    assert auth.public_actor(owner)["password_account"] is False
    assert auth.public_actor(owner)["email"] is None
    with auth.store.transaction() as conn:
        conn.execute("DROP TABLE accounts")
    reopened = Auth(Store(auth.settings.data_dir), auth.settings)
    assert reopened.bootstrap() is False
    assert reopened.session(token, csrf, mutate=True).id == owner.id
    assert reopened.store.verify_audit(owner.tenant)["valid"]
    assert reopened.store.one("SELECT version FROM schema_version")["version"] == 1
    assert reopened.store.all("SELECT * FROM accounts") == []


@pytest.mark.parametrize(
    "password", ["short", "x" * 129, "valid length but\nnewline", "valid length but\x00null"]
)
def test_password_policy_rejects_unsafe_or_unbounded_values_without_creating_data(auth, password):
    rejected("invalid_account", lambda: create(auth, password=password))
    assert auth.store.all("SELECT * FROM accounts") == []


def test_password_models_preserve_whitespace_unicode_and_hide_secret_repr(auth):
    password = "  correct horse ☁ battery  "
    body = RegisterInput(name="  Test person  ", email=" User@EXAMPLE.COM ", password=password)
    assert body.name == "Test person" and body.email == "user@example.com"
    assert body.password.get_secret_value() == password
    actor, _, _, recovery = auth.register(body.name, body.email, body.password.get_secret_value())
    assert auth.login_password("user@example.com", password)[0].id == actor.id
    rejected("unauthorized", lambda: auth.login_password("user@example.com", password.strip()))
    login = LoginInput(email=" User@Example.COM ", password=password)
    change = PasswordChangeInput(current_password=password, new_password=NEW_PASSWORD)
    reset = RecoverInput(email="user@example.com", recovery_code=recovery, new_password=password)
    assert login.password.get_secret_value() == password
    assert change.current_password.get_secret_value() == password
    assert reset.new_password.get_secret_value() == password
    for model in [body, login, change, reset]:
        assert password not in repr(model)
        assert recovery not in repr(model)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"email": "user@example.com"},
        {"password": PASSWORD},
        {"token": OWNER_TOKEN, "email": "user@example.com", "password": PASSWORD},
        {"token": OWNER_TOKEN, "password": PASSWORD},
    ],
)
def test_login_contract_accepts_exactly_one_credential_type(body):
    with pytest.raises(ValidationError):
        LoginInput(**body)


@pytest.mark.parametrize(
    "email",
    ["person", "a@@example.com", "a@", ".a@example.com", "a..b@example.com", "a@bad_domain.com"],
)
def test_email_validator_rejects_ambiguous_ids(email):
    with pytest.raises(ValueError):
        normalize_email(email)
