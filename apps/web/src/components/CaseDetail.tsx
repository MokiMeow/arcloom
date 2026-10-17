import {
  ArrowLeft,
  Download,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Clock3,
  Fingerprint,
} from "lucide-react";
import { useState } from "react";
import { errorText, request, useRemote } from "../api";
import type { Case, Role } from "../types";
import {
  ErrorNotice,
  Loading,
  SectionHead,
  ShortId,
  StateBadge,
  formatDate,
} from "./ui";

export function CaseDetail({
  id,
  revision,
  back,
  changed,
  openCase,
  role,
}: {
  id: string;
  revision: number;
  back: () => void;
  changed: () => void;
  openCase: (id: string) => void;
  role: Role;
}) {
  const {
    data: c,
    error,
    loading,
  } = useRemote<Case>("/api/investigations/" + id, revision, 2000);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [verified, setVerified] = useState<string | null>(null);
  const canReview = role === "admin" || role === "reviewer";
  async function act(path: string, value: unknown = {}) {
    setBusy(true);
    setActionError(null);
    try {
      const result = await request<{
        case_id?: string;
        status?: string;
        reason?: string;
      }>(path, "POST", value);
      setReason("");
      changed();
      if (result.case_id && result.case_id !== id) openCase(result.case_id);
      if (result.status === "no_candidates")
        setActionError(result.reason ?? "No new supported candidates remain.");
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function verifyEvidence(hash: string) {
    setBusy(true);
    setActionError(null);
    try {
      await request("/api/evidence/" + hash);
      setVerified(hash);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading && !c) return <Loading />;
  if (!c)
    return (
      <ErrorNotice message={error ?? "Investigation could not be loaded."} />
    );
  const latest = c.runs?.at(-1);
  const hasDecision =
    c.state === "awaiting_approval" || c.state === "awaiting_review";
  return (
    <>
      <button className="text-button back" onClick={back}>
        <ArrowLeft size={15} />
        All investigations
      </button>
      <SectionHead
        tag={`${c.origin} / ${c.asset_id} / ${c.revision}`}
        title={c.title}
        action={<StateBadge state={c.state} stale={c.stale} />}
      >
        <ShortId value={c.id} /> <span className="inline-separator">/</span>{" "}
        Original attribution: {c.researcher}
      </SectionHead>
      <ErrorNotice message={error || actionError} />
      {c.stale && (
        <div className="notice warning">
          <Clock3 size={19} />
          <span>
            <strong>This conclusion is historical.</strong> A newer deployment
            exists. The old evidence remains intact; stale does not mean fixed.
          </span>
        </div>
      )}
      <div className="case-meta">
        <span>
          <ShieldCheck size={15} />
          Registered synthetic test
        </span>
        <span>
          <Fingerprint size={15} />
          Evidence + reviewer required
        </span>
        <span>Created {formatDate(c.created_at)}</span>
      </div>
      <div className="two-column detail-grid">
        <div className="stack">
          <section className="panel padded">
            <p className="eyebrow">Why this investigation?</p>
            <h2>Follow the evidence, not the conversation.</h2>
            <p className="body-copy">{c.reason}</p>
            {c.path.length > 0 && (
              <div className="path-list">
                {c.path.map((e, i) => (
                  <div className="path-row" key={i}>
                    <code>{e.source}</code>
                    <span>{e.relation}</span>
                    <code>{e.target}</code>
                  </div>
                ))}
              </div>
            )}
            {c.supports.length > 0 && (
              <p className="muted">
                {c.supports.length} supporting finding(s) · investigation depth{" "}
                {c.depth}
              </p>
            )}
            {c.reports?.map((r) => (
              <div className="report-copy" key={r.id}>
                <strong>Report from {r.researcher}</strong>
                <p>{r.description}</p>
              </div>
            ))}
          </section>
          <section className="panel">
            <header className="panel-head">
              <h2>Execution evidence</h2>
              <span className="muted">
                {c.runs?.length ?? 0} recorded attempts
              </span>
            </header>
            {latest ? (
              <div className="padded">
                <div className="receipt-title">
                  <span className={`outcome outcome-${latest.outcome}`}>
                    {latest.outcome.replaceAll("_", " ")}
                  </span>
                  <small className="muted">
                    {latest.revision} · {formatDate(latest.created_at)}
                  </small>
                </div>
                <p className="body-copy">{latest.receipt.conclusion}</p>
                <div className="receipt-facts">
                  <span>
                    Environment<strong>{latest.receipt.environment}</strong>
                  </span>
                  <span>
                    Fixture requests
                    <strong>{latest.receipt.request_count ?? "Unknown"}</strong>
                  </span>
                </div>
                <div className="assertions">
                  {latest.receipt.observations.map((o, i) => (
                    <div className="assertion" key={i}>
                      <span className="ordinal">{i + 1}</span>
                      <div>
                        <strong>
                          {String(o.label ?? o.assertion ?? "Observation")}
                        </strong>
                        <code>{o.path}</code>
                      </div>
                      <span className="badge">HTTP {o.status}</span>
                    </div>
                  ))}
                </div>
                <div className="hash-box">
                  <label>SHA-256 artifact digest</label>
                  <code>{latest.evidence_hash}</code>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void verifyEvidence(latest.evidence_hash)}
                  >
                    <ShieldCheck size={14} />
                    {verified === latest.evidence_hash
                      ? "Integrity verified against stored bytes"
                      : "Verify evidence integrity"}
                  </button>
                </div>
                <details className="details">
                  <summary>Inspect the signed receipt</summary>
                  <pre>{JSON.stringify(latest.receipt, null, 2)}</pre>
                </details>
                {(c.runs?.length ?? 0) > 1 && (
                  <details className="details">
                    <summary>Earlier attempts</summary>
                    {c.runs?.slice(0, -1).map((r) => (
                      <p key={r.id}>
                        <ShortId value={r.id} /> · {r.outcome} ·{" "}
                        {formatDate(r.created_at)}
                      </p>
                    ))}
                  </details>
                )}
              </div>
            ) : (
              <div className="empty small">
                <ShieldCheck size={25} />
                <h3>No test has run</h3>
                <p>
                  An explicit approval must precede a lab execution. A report or
                  graph path cannot establish a finding.
                </p>
              </div>
            )}
          </section>
        </div>
        <aside className="stack">
          <section className="panel padded review-panel">
            <p className="eyebrow">Human checkpoint</p>
            <h2>
              {c.state === "awaiting_approval"
                ? "Authorize a bounded test."
                : c.state === "awaiting_review"
                  ? "Review what was observed."
                  : "Keep the state honest."}
            </h2>
            {hasDecision && canReview ? (
              <>
                <p className="body-copy">
                  {c.state === "awaiting_approval"
                    ? "The worker rechecks scope, revision, reviewer access, expiry, and budget immediately before execution."
                    : "Accept the recorded outcome only after inspecting the evidence. A negative or inconclusive outcome will not create a confirmed finding."}
                </p>
                <label>
                  Decision rationale
                  <textarea
                    rows={4}
                    minLength={5}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Explain this approval or evidence review…"
                  />
                </label>
                <div className="decision-buttons">
                  {c.state === "awaiting_approval" ? (
                    <>
                      <button
                        className="button primary"
                        disabled={busy || reason.trim().length < 5 || c.stale}
                        onClick={() =>
                          void act(`/api/investigations/${id}/approve`, {
                            decision: "approve",
                            reason,
                          })
                        }
                      >
                        <ShieldCheck size={16} />
                        Approve lab test
                      </button>
                      <button
                        className="button"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          void act(`/api/investigations/${id}/approve`, {
                            decision: "deny",
                            reason,
                          })
                        }
                      >
                        Deny execution
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="button primary"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          void act(`/api/investigations/${id}/review`, {
                            decision: "accept",
                            reason,
                          })
                        }
                      >
                        <CheckCircle2 size={16} />
                        Accept recorded outcome
                      </button>
                      <button
                        className="button"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          void act(`/api/investigations/${id}/review`, {
                            decision: "needs_info",
                            reason,
                          })
                        }
                      >
                        More evidence needed
                      </button>
                      <button
                        className="button danger-text"
                        disabled={busy || reason.trim().length < 5}
                        onClick={() =>
                          void act(`/api/investigations/${id}/review`, {
                            decision: "reject",
                            reason,
                          })
                        }
                      >
                        Reject conclusion
                      </button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="body-copy">
                  {c.state === "running" || c.state === "queued"
                    ? "Waiting for the bounded execution to finish. The durable job retains its approval and revision."
                    : !canReview
                      ? "Your role can inspect this case. A reviewer or workspace owner must approve tests and accept outcomes."
                      : "Every state change is retained in the audit trail. No model can promote its own conclusion."}
                </p>
                {c.state === "inconclusive" && !c.stale && canReview && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => void act(`/api/investigations/${id}/retry`)}
                  >
                    Request a new approved attempt
                  </button>
                )}
                {c.finding && !c.stale && canReview && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void act("/api/agents/discover", {
                        source_finding_id: c.finding!.id,
                      })
                    }
                  >
                    <Sparkles size={16} />
                    Investigate connected paths
                  </button>
                )}
                {c.finding && c.stale && canReview && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void act(`/api/findings/${c.finding!.id}/revalidate`)
                    }
                  >
                    Revalidate on current revision
                  </button>
                )}
              </>
            )}
          </section>
          <section className="panel padded">
            <p className="eyebrow">Review trail</p>
            {[...(c.approvals ?? []), ...(c.reviews ?? [])].length ? (
              <div className="timeline">
                {[...(c.approvals ?? []), ...(c.reviews ?? [])].map((r) => (
                  <div className="timeline-item" key={r.id}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>{r.decision}</strong>
                      <p>{r.reason}</p>
                      <small>
                        <ShortId value={r.actor} />
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No human decisions recorded yet.</p>
            )}
            <a
              className="button export-button"
              href={`/api/investigations/${id}/export`}
            >
              <Download size={15} />
              Export investigation JSON
            </a>
          </section>
        </aside>
      </div>
    </>
  );
}
