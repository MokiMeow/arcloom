import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Download,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import { errorText, request } from "../api";
import type { Session } from "../types";
import { BrandMark } from "./Brand";
import { PasswordField, passwordProblem } from "./AccountFields";
import "./account-access.css";

type AccessMode = "login" | "register" | "recover";
type RecoverySession = Session & { recovery_code: string };

export function AccountAccess({
  authenticated,
  close,
}: {
  authenticated: (session: Session) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const active = useRef(true);
  const [mode, setMode] = useState<AccessMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<RecoverySession | null>(null);
  const [saved, setSaved] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  useEffect(() => {
    active.current = true;
    const opener = document.activeElement;
    const element = dialog.current;
    if (!element?.open) element?.showModal();
    firstField.current?.focus();
    return () => {
      active.current = false;
      if (element?.open) element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useLayoutEffect(() => {
    if (dialog.current?.open) firstField.current?.focus();
  }, [mode]);
  function changeMode(next: AccessMode) {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirmation("");
    setRecoveryCode("");
    setToken("");
  }
  function finish(session: Session) {
    setPassword("");
    setConfirmation("");
    setRecoveryCode("");
    setToken("");
    setPending(null);
    authenticated({ actor: session.actor, csrf: session.csrf });
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (mode !== "login") {
      const problem = passwordProblem(password);
      if (problem) {
        setError(problem);
        return;
      }
      if (password !== confirmation) {
        setError("Your passwords do not match. Enter the same password twice.");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "login") {
        const session = await request<Session>("/api/auth/login", "POST", {
          email: email.trim(),
          password,
        });
        if (active.current) finish(session);
      } else {
        const result = await request<RecoverySession>(
          mode === "register" ? "/api/auth/register" : "/api/auth/recover",
          "POST",
          mode === "register"
            ? { name: name.trim(), email: email.trim(), password }
            : {
                email: email.trim(),
                recovery_code: recoveryCode.trim(),
                new_password: password,
              },
        );
        if (!active.current) return;
        setPassword("");
        setConfirmation("");
        setRecoveryCode("");
        setPending(result);
        setSaved(false);
        setSkipping(false);
        requestAnimationFrame(() =>
          document.getElementById(`${titleId}-recovery`)?.focus(),
        );
      }
    } catch (cause) {
      if (active.current) setError(errorText(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function submitToken(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = await request<Session>("/api/auth/login", "POST", {
        token,
      });
      if (active.current) finish(session);
    } catch (cause) {
      if (active.current) setError(errorText(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function copyRecovery() {
    if (!pending) return;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(pending.recovery_code);
      setCopyMessage("Recovery code copied. Keep it somewhere private.");
    } catch {
      setCopyMessage(
        "Clipboard unavailable. Select and copy the recovery code manually.",
      );
    }
  }
  function downloadRecovery() {
    if (!pending) return;
    try {
      const url = URL.createObjectURL(
        new Blob(
          [
            `Arcloom account recovery\nEmail: ${email.trim()}\nRecovery code: ${pending.recovery_code}\n\nKeep this code private. Use it with your email to reset account access.\nRecovery replaces this code and signs out existing sessions.\n`,
          ],
          { type: "text/plain;charset=utf-8" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "arcloom-recovery-code.txt";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setCopyMessage("Recovery file prepared. Save it somewhere private.");
    } catch {
      setCopyMessage(
        "Download unavailable. Select and copy the recovery code manually.",
      );
    }
  }
  const title = pending
    ? "Save your recovery code"
    : mode === "register"
      ? "Create your Arcloom account"
      : mode === "recover"
        ? "Recover your account"
        : "Sign in to Arcloom";
  return (
    <dialog
      ref={dialog}
      className="account-access"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (pending) {
          setError(
            "Save your recovery code or choose Continue without saving before leaving this screen.",
          );
          return;
        }
        if (busy) {
          setError(
            "The request is still running. Wait for its result before closing.",
          );
          return;
        }
        close();
      }}
    >
      {!pending && (
        <button
          type="button"
          className="account-close"
          aria-label="Close sign in"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      )}
      <span className="account-brand">
        <BrandMark />
      </span>
      <p className="account-eyebrow">YOUR INVESTIGATION WORKSPACE</p>
      <h2 id={titleId}>{title}</h2>
      {pending ? (
        <div className="account-recovery-panel">
          <p>
            {mode === "register"
              ? "Your private workspace is ready. This code is shown once and lets you reset access if you forget your password."
              : "Your password has been reset and previous sessions signed out. This new code replaces your old recovery code."}
          </p>
          <div className="account-recovery-warning">
            <KeyRound size={18} />
            <p>
              Keep this code private and separate from your password. It will
              not be emailed to you.
            </p>
          </div>
          <label htmlFor={`${titleId}-recovery`}>Your recovery code</label>
          <textarea
            id={`${titleId}-recovery`}
            className="account-recovery-code"
            value={pending.recovery_code}
            readOnly
            rows={2}
            autoComplete="off"
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="account-recovery-actions">
            <button
              type="button"
              className="account-action account-action-secondary"
              onClick={() => void copyRecovery()}
            >
              <Copy size={16} /> Copy recovery code
            </button>
            <button
              type="button"
              className="account-action account-action-secondary"
              onClick={downloadRecovery}
            >
              <Download size={16} /> Download code
            </button>
          </div>
          {copyMessage && (
            <p className="account-status" role="status">
              {copyMessage}
            </p>
          )}
          <label className="account-checkbox">
            <input
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
            />
            I saved this recovery code somewhere safe.
          </label>
          <button
            type="button"
            className="account-action account-action-primary"
            disabled={!saved}
            onClick={() => finish(pending)}
          >
            <Check size={17} /> Enter workspace
          </button>
          {skipping ? (
            <div className="account-recovery-skip">
              <p>
                Without this code, you may be unable to recover access if you
                forget your password.
              </p>
              <button
                type="button"
                className="account-text-button"
                onClick={() => finish(pending)}
              >
                Enter without saving the code
              </button>
              <button
                type="button"
                className="account-text-button"
                onClick={() => setSkipping(false)}
              >
                Go back and save it
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="account-text-button"
              onClick={() => setSkipping(true)}
            >
              Continue without saving
            </button>
          )}
        </div>
      ) : (
        <>
          {mode !== "recover" ? (
            <div
              className="account-mode-switch"
              role="group"
              aria-label="Account access options"
            >
              <button
                type="button"
                aria-pressed={mode === "login"}
                disabled={busy}
                onClick={() => changeMode("login")}
              >
                Sign in
              </button>
              <button
                type="button"
                aria-pressed={mode === "register"}
                disabled={busy}
                onClick={() => changeMode("register")}
              >
                Create account
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="account-text-button account-back"
              disabled={busy}
              onClick={() => changeMode("login")}
            >
              <ArrowLeft size={15} /> Back to sign in
            </button>
          )}
          <p className="account-description">
            {mode === "register"
              ? "Create an individual account and an empty private workspace. Your account does not inherit another workspace’s investigations or credentials."
              : mode === "recover"
                ? "Use your email and saved recovery code to choose a new password. No reset email will be sent."
                : "Sign in with your email and password to continue your investigations."}
          </p>
          <form onSubmit={submit} aria-busy={busy}>
            {mode === "register" && (
              <div className="account-field">
                <label htmlFor={`${titleId}-name`}>Your name</label>
                <input
                  ref={firstField}
                  id={`${titleId}-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  minLength={2}
                  maxLength={60}
                  required
                  disabled={busy}
                />
              </div>
            )}
            <div className="account-field">
              <label htmlFor={`${titleId}-email`}>Email address</label>
              <input
                ref={mode !== "register" ? firstField : undefined}
                id={`${titleId}-email`}
                type="email"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={254}
                disabled={busy}
              />
            </div>
            {mode === "recover" && (
              <div className="account-field">
                <label htmlFor={`${titleId}-saved-code`}>
                  Saved recovery code
                </label>
                <input
                  id={`${titleId}-saved-code`}
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  required
                  maxLength={256}
                  disabled={busy}
                />
              </div>
            )}
            <PasswordField
              label={mode === "recover" ? "New password" : "Password"}
              value={password}
              onChange={setPassword}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              policy={mode !== "login"}
              disabled={busy}
            />
            {mode !== "login" && (
              <PasswordField
                label="Confirm password"
                value={confirmation}
                onChange={setConfirmation}
                autoComplete="new-password"
                disabled={busy}
              />
            )}
            {mode === "login" && (
              <button
                type="button"
                className="account-text-button account-recover-link"
                disabled={busy}
                onClick={() => changeMode("recover")}
              >
                Reset account access
              </button>
            )}
            {error && (
              <p className="account-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="account-action account-action-primary"
              type="submit"
              disabled={busy}
            >
              <span>
                {busy
                  ? "Please wait…"
                  : mode === "register"
                    ? "Create private account"
                    : mode === "recover"
                      ? "Reset account access"
                      : "Sign in with email"}
              </span>
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ArrowRight size={17} />
              )}
            </button>
          </form>
          {mode === "login" && (
            <details className="account-token-access">
              <summary>Advanced workspace token access</summary>
              <p>
                Use an existing workspace token from setup or a workspace owner.
                This signs you into that workspace, not an individual email
                account.
              </p>
              <form onSubmit={submitToken}>
                <label htmlFor={`${titleId}-token`}>
                  Workspace access token
                </label>
                <input
                  id={`${titleId}-token`}
                  type="password"
                  autoComplete="one-time-code"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required
                  minLength={32}
                  maxLength={256}
                  disabled={busy}
                  placeholder="Enter your private access token"
                />
                <button
                  type="submit"
                  className="account-action account-action-secondary"
                  disabled={busy}
                >
                  <KeyRound size={16} /> Enter workspace
                </button>
              </form>
            </details>
          )}
          <p className="account-privacy">
            <ShieldCheck size={15} /> Passwords and access tokens stay out of
            browser storage.
          </p>
        </>
      )}
      {pending && error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
