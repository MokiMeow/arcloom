import { useState } from "react";
import {
  KeyRound,
  ShieldCheck,
  Pause,
  Play,
  GitCommitHorizontal,
  Copy,
} from "lucide-react";
import { errorText, request, useRemote } from "../api";
import type { Dashboard, Role } from "../types";
import { ErrorNotice, SectionHead, formatDate } from "./ui";

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
}: {
  dashboard: Dashboard;
  revision: number;
  changed: () => void;
  role: Role;
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
  return (
    <>
      <SectionHead
        tag="Workspace / Policy"
        title="Make the boundaries explicit."
      >
        Configuration is enforcement, not a suggestion to the model.
      </SectionHead>
      <ErrorNotice message={error || members.error} />
      <div className="two-column">
        <div className="stack">
          <section className="panel padded">
            <p className="eyebrow">Authorized assessment</p>
            <h2>Only our controlled synthetic lab.</h2>
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
                  {d.scope_enabled ? "Open, subject to approval" : "Paused"}
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
          <section className="panel padded">
            <p className="eyebrow">Execution and model budgets</p>
            <h2>Bounded work. Visible cost inputs.</h2>
            <div className="budget-row">
              <span>Lab executions</span>
              <strong>
                {d.budget.executions} / {d.budget.execution_limit}
              </strong>
            </div>
            <progress
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
              value={d.budget.model_calls}
              max={d.budget.model_call_limit}
            />
            <p className="footnote">
              Failed and interrupted calls also consume reserved budget. Token
              counts are provider-reported; no currency savings are assumed.
            </p>
          </section>
        </div>
        <div className="stack">
          <section className="panel padded">
            <p className="eyebrow">Planner configuration</p>
            <h2>
              {d.model.decision_model
                ? "Cloudflare decision model"
                : d.model.live_llm
                  ? "Live model adapter enabled"
                  : "Deterministic graph planner"}
            </h2>
            <dl className="property-list">
              <div>
                <dt>Provider</dt>
                <dd>{d.model.provider}</dd>
              </div>
              <div>
                <dt>Model / policy</dt>
                <dd>{d.model.model}</dd>
              </div>
              <div>
                <dt>Recorded input tokens</dt>
                <dd>{d.model.input_tokens}</dd>
              </div>
              <div>
                <dt>Recorded output tokens</dt>
                <dd>{d.model.output_tokens}</dd>
              </div>
            </dl>
            <div className="notice compact">
              <KeyRound size={16} />
              <span>
                {d.model.remote_model
                  ? "Provider failures stay visible. There is no silent fallback."
                  : "This mode requires no API key and is not represented as a live language model."}
              </span>
            </div>
            <p className="footnote">
              To use OpenAI or Anthropic, set the provider, model ID and key in
              the server environment and restart. Keys never enter this UI,
              graph data, or agent prompts.
            </p>
          </section>
          {role === "admin" && (
            <section className="panel padded">
              <p className="eyebrow">Team access</p>
              <h2>A role for each responsibility.</h2>
              <div className="member-list">
                {members.data?.items.map((m) => (
                  <div key={m.id}>
                    <span>
                      <strong>{m.name}</strong>
                      <small>
                        {m.role} · {m.active ? "active" : "revoked"}
                      </small>
                    </span>
                    {m.active && !m.id.startsWith("admin_") && (
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
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(newToken)
                        .catch(() =>
                          setError(
                            "Clipboard unavailable. Select and copy the token manually.",
                          ),
                        )
                    }
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
