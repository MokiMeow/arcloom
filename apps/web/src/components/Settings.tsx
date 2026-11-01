import { useState } from "react";
import {
  ShieldCheck,
  Pause,
  Play,
  GitCommitHorizontal,
  Copy,
  Gauge,
  Sparkles,
  Database,
  Users,
  UserRound,
} from "lucide-react";
import { errorText, request, useRemote } from "../api";
import type { Dashboard, Role, Session } from "../types";
import { ErrorNotice, SectionHead, formatDate } from "./ui";
import { ProviderSettings } from "./ProviderSettings";
import { GraphHostingSettings } from "./GraphHostingSettings";
import { PUBLIC_DEMO } from "../demoMode";
import { AccountSettings } from "./AccountSettings";

interface Member {
  id: string;
  name: string;
  role: Role;
  active: number;
}
export function Settings({
  dashboard: d,
  revision,
  changed,
  role,
  session,
  onSessionUpdated,
}: {
  dashboard: Dashboard;
  revision: number;
  changed: () => void;
  role: Role;
  session?: Session;
  onSessionUpdated?: (session: Session) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [newRole, setNewRole] = useState<Role>("reviewer");
  const [newToken, setNewToken] = useState<string | null>(null);
  const members = useRemote<{ items: Member[] }>(
    role === "admin" ? "/api/members" : null,
    revision,
  );
  async function change(path: string, value: unknown) {
    setBusy(true);
    setError(null);
    try {
      await request(path, "POST", value);
      changed();
      setReason("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNewToken(null);
    try {
      const r = await request<{ token: string }>("/api/members", "POST", {
        name,
        role: newRole,
      });
      setNewToken(r.token);
      setName("");
      changed();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    if (
      !window.confirm(
        "Revoke this member, their sessions, and their queued approvals?",
      )
    )
      return;
    try {
      await request("/api/members/" + id, "DELETE");
      changed();
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function copyToken() {
    if (!newToken) return;
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(newToken);
    } catch {
      setError("Clipboard unavailable. Select and copy the token manually.");
    }
  }
  const scopeExpired = d.scope_expires_at <= d.at;
  function jumpTo(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    const section = document.getElementById(id);
    section?.focus({ preventScroll: true });
    section?.scrollIntoView({ block: "start" });
  }
  const sections = [
    ...(session && onSessionUpdated && !PUBLIC_DEMO
      ? [
          {
            id: "settings-account",
            label: "Account & sign-in",
            detail: "Your identity & password",
            icon: UserRound,
          },
        ]
      : []),
    {
      id: "settings-scope",
      label: "Scope & revision",
      detail: "Assessment boundaries",
      icon: ShieldCheck,
    },
    {
      id: "settings-budgets",
      label: "Budgets",
      detail: "Execution & model limits",
      icon: Gauge,
    },
    {
      id: "settings-providers",
      label: "Model providers",
      detail: "Investigator configuration",
      icon: Sparkles,
    },
    ...(role === "admin"
      ? [
          {
            id: "settings-graph",
            label: "Graph hosting",
            detail: "Connection & migration",
            icon: Database,
          },
          {
            id: "settings-team",
            label: "Team access",
            detail: "Members & permissions",
            icon: Users,
          },
        ]
      : []),
  ];
  return (
    <>
      <SectionHead tag="Workspace / Policy" title="Workspace policy">
        Manage execution boundaries, model providers and workspace access.
      </SectionHead>
      <nav
        className="settings-navigation"
        aria-label="Workspace policy sections"
      >
        {sections.map((section) => (
          <a
            key={section.id}
            className="settings-navigation-card"
            aria-label={section.label}
            href={`#${section.id}`}
            onClick={(event) => jumpTo(event, section.id)}
          >
            <section.icon size={19} aria-hidden="true" />
            <span className="settings-navigation-copy">
              <strong>{section.label}</strong>
              <small>{section.detail}</small>
            </span>
          </a>
        ))}
      </nav>
      <ErrorNotice message={error || members.error} />
      {PUBLIC_DEMO && (
        <section className="notice">
          <div>
            <strong>Recorded policy view</strong>
            <p>
              Explore this captured workspace's scope and budgets. The full
              application also supports OpenAI, ChatGPT, Gemini, Anthropic and
              Cloudflare planner settings, cloud graph connections and workspace
              roles.
            </p>
            <a
              href="https://github.com/MokiMeow/arcloom/blob/main/docs/provider-setup.md"
              target="_blank"
              rel="noreferrer"
            >
              View live configuration instructions
            </a>
          </div>
        </section>
      )}
      {session && onSessionUpdated && !PUBLIC_DEMO && (
        <AccountSettings
          actor={session.actor}
          onSessionUpdated={onSessionUpdated}
        />
      )}
      <div className="two-column settings-layout">
        <div className="stack">
          <section
            className="panel padded settings-section"
            id="settings-scope"
            tabIndex={-1}
            aria-labelledby="settings-scope-heading"
          >
            <div className="settings-section-heading">
              <div>
                <p className="eyebrow">Authorized assessment</p>
                <h2 id="settings-scope-heading">Scope & deployment revision</h2>
              </div>
              <span
                className={`badge ${scopeExpired ? "state-denied" : d.scope_enabled ? "state-confirmed" : "state-inconclusive"}`}
              >
                {scopeExpired
                  ? "Expired"
                  : d.scope_enabled
                    ? "Admission open"
                    : "Admission paused"}
              </span>
            </div>
            <p className="body-copy">
              No arbitrary URLs, generated shell commands, production
              credentials, or external scans. All execution tools are registered
              and read-only.
            </p>
            <dl className="property-list">
              <div>
                <dt>Workspace</dt>
                <dd>{d.workspace}</dd>
              </div>
              <div>
                <dt>Active revision</dt>
                <dd>
                  {d.revision} · {d.revision_title}
                </dd>
              </div>
              <div>
                <dt>Assessment expires</dt>
                <dd>{formatDate(d.scope_expires_at)}</dd>
              </div>
              <div>
                <dt>Admission</dt>
                <dd>
                  {scopeExpired
                    ? "Assessment expired · new execution blocked"
                    : d.scope_enabled
                      ? "Open, subject to approval"
                      : "Paused"}
                </dd>
              </div>
            </dl>
            {role === "admin" && (
              <>
                <label>
                  Policy change rationale
                  <textarea
                    rows={3}
                    minLength={5}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this scope or deployment changing?"
                  />
                </label>
                <div className="decision-buttons">
                  <button
                    className="button"
                    disabled={busy || reason.trim().length < 5}
                    onClick={() =>
                      void change("/api/scope", {
                        enabled: !d.scope_enabled,
                        reason,
                      })
                    }
                  >
                    {d.scope_enabled ? <Pause size={15} /> : <Play size={15} />}{" "}
                    {d.scope_enabled
                      ? "Pause new executions"
                      : "Resume admission"}
                  </button>
                  <button
                    className="button"
                    disabled={
                      busy || reason.trim().length < 5 || d.revision !== "r1"
                    }
                    onClick={() =>
                      void change("/api/revisions", { revision: "r2", reason })
                    }
                  >
                    <GitCommitHorizontal size={16} />
                    Advance lab to patched r2
                  </button>
                </div>
                <p className="footnote">
                  A revision change preserves historical findings and requires
                  revalidation. Pausing prevents new admission; already-started
                  bounded tests may finish.
                </p>
              </>
            )}
          </section>
          <section
            className="panel padded settings-section"
            id="settings-budgets"
            tabIndex={-1}
            aria-labelledby="settings-budgets-heading"
          >
            <p className="eyebrow">Usage & limits</p>
            <h2 id="settings-budgets-heading">Execution & model budgets</h2>
            <div className="budget-row">
              <span>Lab executions</span>
              <strong>
                {d.budget.executions} / {d.budget.execution_limit}
              </strong>
            </div>
            <progress
              aria-label="Lab execution budget"
              value={d.budget.executions}
              max={d.budget.execution_limit}
            />
            <div className="budget-row">
              <span>Model-call reservations</span>
              <strong>
                {d.budget.model_calls} / {d.budget.model_call_limit}
              </strong>
            </div>
            <progress
              aria-label="Model-call reservation budget"
              value={d.budget.model_calls}
              max={d.budget.model_call_limit}
            />
            <p className="footnote">
              Failed and interrupted calls also consume reserved budget. Token
              counts are provider-reported; no currency savings are assumed.
            </p>
          </section>
          {role === "admin" && (
            <div id="settings-graph" className="settings-section" tabIndex={-1}>
              <GraphHostingSettings revision={revision} role={role} />
            </div>
          )}
        </div>
        <div className="stack">
          <div
            id="settings-providers"
            className="settings-section"
            tabIndex={-1}
          >
            <ProviderSettings
              model={d.model}
              revision={revision}
              changed={changed}
              role={role}
            />
          </div>
          {role === "admin" && (
            <section
              className="panel padded settings-section"
              id="settings-team"
              tabIndex={-1}
              aria-labelledby="settings-team-heading"
            >
              <p className="eyebrow">Identity & permissions</p>
              <h2 id="settings-team-heading">Team access</h2>
              <div className="member-list">
                {members.data?.items.map((m) => (
                  <div key={m.id}>
                    <span>
                      <strong>{m.name}</strong>
                      <small>
                        {m.role} · {m.active ? "active" : "revoked"}
                      </small>
                    </span>
                    {m.active &&
                      m.id !== session?.actor.id &&
                      !m.id.startsWith("admin_") && (
                        <button
                          className="text-button danger-text"
                          onClick={() => void revoke(m.id)}
                        >
                          Revoke
                        </button>
                      )}
                  </div>
                ))}
              </div>
              <form onSubmit={add}>
                <label>
                  Member name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                    maxLength={60}
                  />
                </label>
                <label>
                  Role
                  <select
                    aria-label="Member role"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as Role)}
                  >
                    {["viewer", "researcher", "reviewer", "admin"].map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="button" disabled={busy}>
                  <ShieldCheck size={15} />
                  Create access token
                </button>
              </form>
              {newToken && (
                <div className="one-time-token">
                  <strong>Shown once. Share securely.</strong>
                  <code>{newToken}</code>
                  <button
                    className="text-button"
                    onClick={() => void copyToken()}
                  >
                    <Copy size={14} />
                    Copy token
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setNewToken(null)}
                  >
                    Dismiss token
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
