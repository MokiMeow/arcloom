import { useState } from "react";
import { CheckCheck, Download, Search } from "lucide-react";
import { errorText, request, useRemote } from "../api";
import type { Agent, AuditEvent, Events } from "../types";
import { PUBLIC_DEMO } from "../demoMode";
import { FullIdentifier } from "./FullIdentifier";
import { Empty, ErrorNotice, Loading, SectionHead, formatDate } from "./ui";
import { DecisionReceipt } from "./DecisionReceipt";

export function Activity({
  revision,
  openCase,
}: {
  revision: number;
  openCase: (id: string) => void;
}) {
  const events = useRemote<Events>("/api/events?limit=200", revision, 3000);
  const agents = useRemote<{ items: Agent[] }>(
    "/api/agents?limit=30",
    revision,
    5000,
  );
  const [audit, setAudit] = useState<{
    valid: boolean;
    checked: number;
    head_hash?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [more, setMore] = useState<AuditEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [mobilePane, setMobilePane] = useState<"audit" | "agents">("audit");
  const unique = [
    ...new Map(
      [...(events.data?.items ?? []), ...more].map((e) => [e.seq, e]),
    ).values(),
  ].sort((a, b) => b.seq - a.seq);
  const kinds = [...new Set(unique.map((event) => event.kind))].sort();
  const normalized = search.trim().toLowerCase();
  const filtered = unique.filter(
    (event) =>
      (!kind || event.kind === kind) &&
      `${event.kind} ${event.actor} ${event.object_id} ${event.seq}`
        .toLowerCase()
        .includes(normalized),
  );
  async function verify() {
    if (verifying) return;
    setVerifying(true);
    setError(null);
    try {
      setAudit(await request("/api/audit/verify"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setVerifying(false);
    }
  }
  async function nextPage() {
    setLoadingMore(true);
    setError(null);
    try {
      const cursor = unique.length ? Math.max(...unique.map((e) => e.seq)) : 0;
      const page = await request<Events>(
        `/api/events?limit=200&after=${cursor}`,
      );
      setMore((prev) => [...prev, ...page.items]);
      setHasMore(page.has_more);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoadingMore(false);
    }
  }
  function exportHead() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "arcloom-audit-head.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <SectionHead
        tag="Activity / Provenance"
        title="Nothing disappears between sessions."
        action={
          <button
            className="button"
            disabled={verifying}
            aria-busy={verifying}
            onClick={() => void verify()}
          >
            <CheckCheck size={16} />
            {PUBLIC_DEMO ? "View recorded audit check" : "Verify audit chain"}
          </button>
        }
      >
        Inspect recorded events, human decisions, and independent agent
        contexts. The ledger preserves who acted, on which object, and when.
      </SectionHead>
      <ErrorNotice message={error} />
      {verifying && (
        <p className="muted" role="status">
          {PUBLIC_DEMO
            ? "Reading the recorded audit verification…"
            : "Verifying the audit chain…"}
        </p>
      )}
      {audit && (
        <div
          className={`notice ${audit.valid ? "success" : "error"}`}
          role={audit.valid ? "status" : "alert"}
        >
          <CheckCheck size={18} />
          <div>
            <strong>
              {audit.valid
                ? `${PUBLIC_DEMO ? "Recorded verification covered" : "Verified"} ${audit.checked} audit events.`
                : "Audit chain integrity failed."}
            </strong>
            {audit.head_hash && (
              <FullIdentifier
                value={audit.head_hash}
                label="audit head SHA-256 digest"
              />
            )}
            {audit.valid && (
              <p>
                Export this verified head to an independent trusted location for
                anchoring. Verification covers the recorded event chain.
              </p>
            )}
          </div>
          {audit.valid && (
            <button className="text-button" onClick={exportHead}>
              <Download size={14} />
              Export head hash
            </button>
          )}
        </div>
      )}
      <dl className="activity-summary">
        <div>
          <dt>Loaded audit events</dt>
          <dd>{events.data ? unique.length : "—"}</dd>
        </div>
        <div>
          <dt>Loaded agent contexts</dt>
          <dd>{agents.data ? agents.data.items.length : "—"}</dd>
        </div>
        <div>
          <dt>Audit verification</dt>
          <dd>{audit ? (audit.valid ? "Passed" : "Failed") : "Not checked"}</dd>
        </div>
      </dl>
      <div
        className="activity-view-switch"
        role="group"
        aria-label="Activity sections"
      >
        <button
          type="button"
          aria-pressed={mobilePane === "audit"}
          aria-controls="activity-audit-panel"
          onClick={() => setMobilePane("audit")}
        >
          Audit journal
        </button>
        <button
          type="button"
          aria-pressed={mobilePane === "agents"}
          aria-controls="activity-agent-panel"
          onClick={() => setMobilePane("agents")}
        >
          Agent contexts
        </button>
      </div>
      <div
        className="two-column activity-workbench"
        data-mobile-pane={mobilePane}
      >
        <section
          className="panel activity-ledger-panel"
          id="activity-audit-panel"
        >
          <header className="panel-head">
            <h2>Decision ledger</h2>
            <span className="muted">
              {events.data ? `${unique.length} loaded` : "Awaiting records"}
            </span>
          </header>
          <ErrorNotice message={events.error} />
          {events.loading && !events.data ? (
            <Loading />
          ) : !events.data && events.error ? (
            <div className="padded">
              <Empty title="Activity could not be loaded">
                Your records have not been changed. Retry the request to inspect
                the ledger.
              </Empty>
              <button className="button" onClick={() => void events.refresh()}>
                Retry activity
              </button>
            </div>
          ) : unique.length ? (
            <>
              <div className="activity-filters">
                <label className="search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    aria-label="Filter loaded audit events"
                    placeholder="Find an event, actor or object ID"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <select
                  aria-label="Filter audit event kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value)}
                >
                  <option value="">Every event kind</option>
                  {kinds.map((value) => (
                    <option key={value} value={value}>
                      {value.replaceAll(".", " / ").replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <span className="muted" role="status">
                  {filtered.length} of {unique.length} loaded events
                </span>
              </div>
              <div className="ledger">
                {filtered.length ? (
                  filtered.map((e) => (
                    <details key={e.seq} className="ledger-event">
                      <summary>
                        <span className="ordinal">{e.seq}</span>
                        <span>
                          <strong>
                            {e.kind.replaceAll(".", " / ").replaceAll("_", " ")}
                          </strong>
                          <small>
                            {formatDate(e.at)} · {e.actor}
                          </small>
                          <code className="ledger-object">{e.object_id}</code>
                        </span>
                      </summary>
                      <div>
                        <pre
                          className="activity-payload-json"
                          tabIndex={0}
                          aria-label="Audit event payload JSON"
                        >
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                        <dl className="audit-event-identifiers">
                          <div>
                            <dt>Object ID</dt>
                            <dd>
                              <FullIdentifier
                                value={e.object_id}
                                label="event object ID"
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>Actor ID</dt>
                            <dd>
                              <FullIdentifier
                                value={e.actor}
                                label="event actor ID"
                              />
                            </dd>
                          </div>
                          <div>
                            <dt>Event SHA-256</dt>
                            <dd>
                              <FullIdentifier
                                value={e.event_hash}
                                label="event SHA-256 digest"
                              />
                            </dd>
                          </div>
                        </dl>
                        {e.object_id.startsWith("case_") && (
                          <button
                            className="text-button"
                            onClick={() => openCase(e.object_id)}
                          >
                            Open investigation
                          </button>
                        )}
                      </div>
                    </details>
                  ))
                ) : (
                  <Empty title="No loaded events match">
                    Try another actor, object ID or event kind. Filters apply to
                    loaded records, not the full journal.
                  </Empty>
                )}
              </div>
            </>
          ) : (
            <Empty title="No audit events recorded">
              Recorded workspace actions will appear here with their actor,
              timestamp, and event hash.
            </Empty>
          )}
          {(events.data?.has_more || more.length > 0) && (
            <button
              className="button ledger-more"
              disabled={loadingMore}
              aria-busy={loadingMore}
              onClick={() => void nextPage()}
            >
              {loadingMore
                ? "Loading events…"
                : hasMore
                  ? "Load next 200 events"
                  : "Check for newer events"}
            </button>
          )}
        </section>
        <section
          className="panel activity-agent-panel"
          id="activity-agent-panel"
        >
          <header className="panel-head">
            <h2>Independent agent contexts</h2>
            {agents.data && (
              <span className="badge">{agents.data.items.length} loaded</span>
            )}
          </header>
          <ErrorNotice message={agents.error} />
          {agents.loading && !agents.data ? (
            <Loading />
          ) : !agents.data && agents.error ? (
            <div className="padded">
              <Empty title="Agent contexts could not be loaded">
                This is a request failure, not an empty history.
              </Empty>
              <button className="button" onClick={() => void agents.refresh()}>
                Retry agent contexts
              </button>
            </div>
          ) : agents.data?.items.length ? (
            <div className="padded stack">
              {agents.data.items.map((a) => (
                <article className="agent-card" key={a.id}>
                  <div className="agent-card-heading">
                    <h3>
                      <FullIdentifier value={a.id} label="agent session ID" />
                    </h3>
                    <span className="badge">
                      {a.status.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p>{a.reason}</p>
                  <div className="agent-facts">
                    <span>
                      Previous conversation
                      <strong>{a.previous_messages} messages</strong>
                    </span>
                    <span>
                      Selection engine<strong>{a.provider}</strong>
                    </span>
                    <span>
                      Graph candidates<strong>{a.candidates.length}</strong>
                    </span>
                    <span>
                      Recorded tokens
                      <strong>{a.input_tokens + a.output_tokens}</strong>
                    </span>
                  </div>
                  <DecisionReceipt decision={a.decision} />
                  {a.case_id && (
                    <button
                      className="text-button"
                      onClick={() => openCase(a.case_id!)}
                    >
                      Open proposed investigation
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <Empty title="No agent sessions yet">
              Agents begin with graph data after a finding is reviewed.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
