import {
  ArrowLeft,
  Download,
  ShieldCheck,
  Sparkles,
  CheckCircle2,
  Clock3,
  Fingerprint,
  FileText,
  Play,
  Circle,
  CircleCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, request, useRemote } from "../api";
import type { Case, Role } from "../types";
import { PUBLIC_DEMO } from "../demoMode";
import { FullIdentifier } from "./FullIdentifier";
import {
  ErrorNotice,
  Loading,
  SectionHead,
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
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function act(path: string, value: unknown = {}) {
    setBusy(true);
    setActionError(null);
    try {
      const result = await request<{
        case_id?: string;
        status?: string;
        reason?: string;
      }>(path, "POST", value);
      changed();
      if (!active.current) return;
      setReason("");
      if (result.case_id && result.case_id !== id) openCase(result.case_id);
      if (result.status === "no_candidates")
        setActionError(result.reason ?? "No new supported candidates remain.");
    } catch (e) {
      if (active.current) setActionError(errorText(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function verifyEvidence(hash: string) {
    setBusy(true);
    setActionError(null);
    try {
      await request("/api/evidence/" + hash);
      if (active.current) setVerified(hash);
    } catch (e) {
      if (active.current) setActionError(errorText(e));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  async function downloadRecordedExport(
    event: React.MouseEvent<HTMLAnchorElement>,
  ) {
    if (!PUBLIC_DEMO) return;
    event.preventDefault();
    try {
      const value = await request(`/api/investigations/${id}/export`);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `arcloom-recorded-demo-${id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setActionError(errorText(e));
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
  const approval = c.approvals?.at(-1);
  const executionPending = ["awaiting_approval", "queued", "running"].includes(
    c.state,
  );
  const retainedEvidence = Boolean(
    latest && (executionPending || c.state === "denied"),
  );
  // Retries retain earlier runs and reviews. A review belongs to a specific
  // run; its presence must not complete a new attempt's human checkpoint.
  const review = latest
    ? c.reviews?.find((entry) => entry.run_id === latest.id)
    : undefined;
  const reviewComplete =
    !executionPending &&
    c.state !== "denied" &&
    c.state !== "awaiting_review" &&
    Boolean(review);
  const stages = [
    {
      label: c.origin === "report" ? "Report" : "Hypothesis",
      detail: c.origin === "report" ? "Recorded" : "Proposed",
      status: "complete",
      icon: FileText,
    },
    {
      label: "Execution approval",
      detail:
        c.state === "awaiting_approval"
          ? "Needs a reviewer"
          : approval?.decision === "deny" || c.state === "denied"
            ? "Denied"
            : approval?.decision === "approve"
              ? "Approved"
              : "Not recorded",
      status:
        c.state === "awaiting_approval"
          ? "current"
          : approval?.decision === "deny" || c.state === "denied"
            ? "blocked"
            : approval?.decision === "approve"
              ? "complete"
              : "waiting",
      icon: ShieldCheck,
    },
    {
      label: "Runner observation",
      detail:
        c.state === "running"
          ? "Running in lab"
          : c.state === "queued"
            ? "Queued"
            : retainedEvidence
              ? "Previous attempt retained"
              : latest
                ? "Evidence recorded"
                : "Not executed",
      status:
        c.state === "running" || c.state === "queued"
          ? "current"
          : !retainedEvidence && latest
            ? "complete"
            : "waiting",
      icon: Play,
    },
    {
      label: "Evidence review",
      detail:
        c.state === "awaiting_review"
          ? "Needs a reviewer"
          : executionPending || c.state === "denied"
            ? "Waiting for a new observation"
            : reviewComplete && review?.decision === "accept"
              ? "Outcome accepted"
              : reviewComplete && review?.decision === "reject"
                ? "Conclusion rejected"
                : reviewComplete && review?.decision === "needs_info"
                  ? "More evidence needed"
                  : "Not reviewed",
      status:
        c.state === "awaiting_review"
          ? "current"
          : reviewComplete
            ? "complete"
            : "waiting",
      icon: Fingerprint,
    },
  ];
  return (
    <>
      <button className="text-button back" onClick={back}>
        <ArrowLeft size={15} />
        All investigations
      </button>
      <SectionHead
        tag={`Investigations / ${c.origin} / ${c.revision}`}
        title={c.title}
        action={<StateBadge state={c.state} stale={c.stale} />}
      >
        Registered test: {c.test_id}
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
      <ol className="case-progress" aria-label="Investigation stages">
        {stages.map((stage, index) => (
          <li
            key={stage.label}
            className={`case-progress-step case-progress-${stage.status}`}
            aria-current={stage.status === "current" ? "step" : undefined}
          >
            <span className="case-progress-icon" aria-hidden="true">
              {stage.status === "complete" ? (
                <CircleCheck size={18} />
              ) : stage.status === "waiting" ? (
                <Circle size={18} />
              ) : (
                <stage.icon size={18} />
              )}
            </span>
            <span>
              <strong>{stage.label}</strong>
              <small>{stage.detail}</small>
            </span>
            <span className="case-progress-number" aria-hidden="true">
              0{index + 1}
            </span>
          </li>
        ))}
      </ol>
      <dl className="case-record-metadata">
        <div className="case-record-identifier">
          <dt>Investigation ID</dt>
          <dd>
            <FullIdentifier value={c.id} label="investigation ID" />
          </dd>
        </div>
        {c.finding && (
          <div className="case-record-identifier">
            <dt>Finding ID</dt>
            <dd>
              <FullIdentifier value={c.finding.id} label="finding ID" />
            </dd>
          </div>
        )}
        <div>
          <dt>Asset</dt>
          <dd>{c.asset_id}</dd>
        </div>
        <div>
          <dt>Original researcher</dt>
          <dd>{c.researcher}</dd>
        </div>
        <div>
          <dt>Deployment revision</dt>
          <dd>
            {c.revision}
            {c.stale ? " · historical" : " · current"}
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(c.created_at)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDate(c.updated_at ?? c.created_at)}</dd>
        </div>
      </dl>
      <div className="two-column detail-grid case-workbench">
        <div className="stack">
          <section className="panel case-context-panel">
            <header className="panel-head">
              <h2>Investigation context</h2>
              <span className="badge">{c.origin}</span>
            </header>
            <div className="padded">
              <p className="body-copy">{c.reason}</p>
              {c.supports.length > 0 && (
                <p className="muted">
                  {c.supports.length} supporting finding(s) · investigation
                  depth {c.depth}
                </p>
              )}
              {c.reports?.map((r) => (
                <div className="report-copy" key={r.id}>
                  <strong>Report from {r.researcher}</strong>
                  <p>{r.description}</p>
                </div>
              ))}
              {c.path.length > 0 && (
                <details className="details case-support-path">
                  <summary>
                    Supporting graph path · {c.path.length} relationships
                  </summary>
                  <div className="path-list">
                    {c.path.map((e, i) => (
                      <div className="path-row" key={i}>
                        <FullIdentifier
                          value={e.source}
                          label="supporting path source ID"
                        />
                        <span>{e.relation}</span>
                        <FullIdentifier
                          value={e.target}
                          label="supporting path target ID"
                        />
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </section>
          <section className="panel">
            <header className="panel-head">
              <h2>Execution evidence</h2>
              <span className="muted">
                {c.runs?.length ?? 0} recorded attempts
              </span>
            </header>
            {(executionPending ||
              (retainedEvidence && c.state === "denied")) && (
              <div className="notice case-attempt-status" role="status">
                <Clock3 size={18} />
                <div>
                  <strong>
                    {c.state === "awaiting_approval"
                      ? "This attempt needs a new execution approval."
                      : c.state === "queued"
                        ? "The newly approved attempt is queued."
                        : c.state === "running"
                          ? "The current attempt is running in the lab."
                          : "No new execution was authorized."}
                  </strong>
                  <p>
                    {latest
                      ? "The receipt below is previous-attempt evidence. It does not complete this attempt’s observation or evidence review."
                      : "A new observation must be recorded before its evidence can be reviewed."}
                  </p>
                </div>
              </div>
            )}
            {latest ? (
              <div className="padded">
                {retainedEvidence && (
                  <p className="eyebrow">Previous-attempt evidence</p>
                )}
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
                        <code className="full-identifier-value">{o.path}</code>
                        {o.body_sha256 && (
                          <details className="observation-digest">
                            <summary>Response body SHA-256</summary>
                            <FullIdentifier
                              value={o.body_sha256}
                              label="response body SHA-256 digest"
                            />
                          </details>
                        )}
                      </div>
                      <span className="badge">HTTP {o.status}</span>
                    </div>
                  ))}
                </div>
                <div className="hash-box">
                  <span className="hash-label">SHA-256 artifact digest</span>
                  <FullIdentifier
                    value={latest.evidence_hash}
                    label="artifact SHA-256 digest"
                  />
                  <span className="hash-label">Run ID</span>
                  <FullIdentifier value={latest.id} label="run ID" />
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void verifyEvidence(latest.evidence_hash)}
                  >
                    <ShieldCheck size={14} />
                    {PUBLIC_DEMO
                      ? verified === latest.evidence_hash
                        ? "Recorded integrity check passed"
                        : "View recorded integrity check"
                      : verified === latest.evidence_hash
                        ? "Integrity verified against stored bytes"
                        : "Verify evidence integrity"}
                  </button>
                </div>
                <details className="details">
                  <summary>Inspect the signed receipt</summary>
                  <pre
                    className="receipt-json"
                    tabIndex={0}
                    aria-label="Signed receipt JSON"
                  >
                    {JSON.stringify(latest.receipt, null, 2)}
                  </pre>
                </details>
                {(c.runs?.length ?? 0) > 1 && (
                  <details className="details">
                    <summary>Earlier attempts</summary>
                    {c.runs?.slice(0, -1).map((r) => (
                      <div className="earlier-attempt" key={r.id}>
                        <FullIdentifier value={r.id} label="earlier run ID" />
                        <p>
                          {r.outcome.replaceAll("_", " ")} ·{" "}
                          {formatDate(r.created_at)}
                        </p>
                        <FullIdentifier
                          value={r.evidence_hash}
                          label="earlier artifact SHA-256 digest"
                        />
                      </div>
                    ))}
                  </details>
                )}
              </div>
            ) : (
              <div className="empty small">
                <ShieldCheck size={25} />
                <h3>
                  {c.state === "running" || c.state === "queued"
                    ? "No observation recorded yet"
                    : "No test has run"}
                </h3>
                <p>
                  An explicit approval must precede a lab execution. A report or
                  graph path cannot establish a finding.
                </p>
              </div>
            )}
          </section>
        </div>
        <aside className="stack">
          <section className="panel padded review-panel case-checkpoint">
            <div className="case-checkpoint-status">
              <p className="eyebrow">
                {c.state === "awaiting_approval"
                  ? "01 / Execution approval"
                  : c.state === "awaiting_review"
                    ? "02 / Evidence review"
                    : "Human checkpoint"}
              </p>
              {hasDecision && (
                <span className="badge checkpoint-pending">
                  {canReview ? "Your decision required" : "Reviewer required"}
                </span>
              )}
            </div>
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
                      <FullIdentifier value={r.actor} label="reviewer ID" />
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
              onClick={(event) => void downloadRecordedExport(event)}
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
