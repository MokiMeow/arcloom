import { useState } from "react";
import {
  ChevronDown,
  LoaderCircle,
  LockKeyhole,
  UserRound,
} from "lucide-react";
import { errorText, request } from "../api";
import type { Actor, Session } from "../types";
import { PasswordField, passwordProblem } from "./AccountFields";
import "./account-access.css";

export function AccountSettings({
  actor,
  onSessionUpdated,
}: {
  actor: Actor;
  onSessionUpdated: (session: Session) => void;
}) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setMessage(null);
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirmation) {
      setError(
        "Your new passwords do not match. Enter the same password twice.",
      );
      return;
    }
    setBusy(true);
    try {
      const session = await request<Session>("/api/auth/password", "POST", {
        current_password: current,
        new_password: password,
      });
      setCurrent("");
      setPassword("");
      setConfirmation("");
      onSessionUpdated(session);
      setMessage(
        "Password changed. Your current session has been renewed; your other sessions have been signed out.",
      );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel padded settings-section account-settings"
      id="settings-account"
      tabIndex={-1}
      aria-labelledby="settings-account-heading"
    >
      <div className="settings-section-heading">
        <div>
          <p className="eyebrow">Your identity</p>
          <h2 id="settings-account-heading">Account & sign-in</h2>
        </div>
        <span className="account-profile-icon">
          <UserRound size={22} />
        </span>
      </div>
      <dl className="property-list account-profile">
        <div>
          <dt>Account ID</dt>
          <dd>
            <code>{actor.id}</code>
          </dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd>{actor.name || "Not provided for this session"}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{actor.email || "Workspace token session"}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{actor.tenant}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{actor.role}</dd>
        </div>
      </dl>
      {actor.password_account ? (
        <details className="account-password-settings">
          <summary>
            <LockKeyhole size={16} /> Change password
            <ChevronDown size={16} aria-hidden="true" />
          </summary>
          <p className="body-copy">
            Confirm your current password before choosing a new one. Other
            signed-in sessions are signed out, and this session is renewed.
          </p>
          <form onSubmit={changePassword} aria-busy={busy}>
            <PasswordField
              label="Current password"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              disabled={busy}
            />
            <PasswordField
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              policy
              disabled={busy}
            />
            <PasswordField
              label="Confirm new password"
              value={confirmation}
              onChange={setConfirmation}
              autoComplete="new-password"
              disabled={busy}
            />
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            {message && (
              <p className="account-status" role="status">
                {message}
              </p>
            )}
            <button
              type="submit"
              className="account-action account-action-primary"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <LockKeyhole size={17} />
              )}
              {busy ? "Updating password…" : "Update password"}
            </button>
          </form>
        </details>
      ) : (
        <p className="account-token-note">
          You signed in with a workspace access token. Email and password
          management is available for individual accounts; workspace owners
          manage token membership under Team access.
        </p>
      )}
    </section>
  );
}
