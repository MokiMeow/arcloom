import { useState } from "react";
import { CheckCheck, Download } from "lucide-react";
import { errorText, request, useRemote } from "../api";
import type { Agent, AuditEvent, Events } from "../types";
import { Empty, ErrorNotice, SectionHead, ShortId, formatDate } from "./ui";

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
  const [more, setMore] = useState<AuditEvent[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const unique = [
    ...new Map(
      [...(events.data?.items ?? []), ...more].map((e) => [e.seq, e]),
    ).values(),
  ].sort((a, b) => b.seq - a.seq);
  async function verify() {
    try {
      setAudit(await request("/api/audit/verify"));
    } catch (e) {
      setError(errorText(e));
    }
  }
  async function nextPage() {
    setLoadingMore(true);
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
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <SectionHead
        tag="Activity / Provenance"
        title="Nothing disappears between sessions."
        action={
          <button className="button" onClick={() => void verify()}>
            <CheckCheck size={16} />
            Verify audit chain
          </button>
        }
      >
        Each transition records its actor, time, and predecessor hash. Export
        the head to an independent trusted location for anchoring.
      </SectionHead>
      <ErrorNotice message={error || events.error || agents.error} />
      {audit && (
        <div className={`notice ${audit.valid ? "success" : "error"}`}>
          <CheckCheck size={18} />
          <span>
            {audit.valid
              ? `Verified ${audit.checked} audit events.`
              : "Audit chain integrity failed."}
          </span>
          {audit.valid && (
            <button className="text-button" onClick={exportHead}>
              <Download size={14} />
              Export head hash
            </button>
          )}
        </div>
      )}
      <div className="two-column">
        <section className="panel">
          <header className="panel-head">
            <h2>Decision ledger</h2>
            <span className="muted">{unique.length} loaded</span>
          </header>
          <div className="ledger">
            {unique.map((e) => (
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
                  </span>
                </summary>
                <div>
                  <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                  <small className="break-all muted">
                    Event SHA-256: {e.event_hash}
                  </small>
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
            ))}
          </div>
          {events.data?.has_more && hasMore && (
            <button
              className="button ledger-more"
              disabled={loadingMore}
              onClick={() => void nextPage()}
            >
              Load next 200 events
            </button>
          )}
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2>Independent agent contexts</h2>
          </header>
          {agents.data?.items.length ? (
            <div className="padded stack">
              {agents.data.items.map((a) => (
                <article className="agent-card" key={a.id}>
                  <span className="badge">{a.status}</span>
                  <h3>
                    <ShortId value={a.id} />
                  </h3>
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
