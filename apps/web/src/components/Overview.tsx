import {
  ArrowRight,
  ArrowUpRight,
  Database,
  Fingerprint,
  GitBranch,
  Sparkles,
} from "lucide-react";
import type { Dashboard, CasePage, Agent } from "../types";
import { useRemote } from "../api";
import {
  Empty,
  ErrorNotice,
  Loading,
  SectionHead,
  StateBadge,
  formatDate,
} from "./ui";

export function Overview({
  dashboard: d,
  revision,
  openCase,
  discover,
  busy,
}: {
  dashboard: Dashboard;
  revision: number;
  openCase: (id: string) => void;
  discover: () => void;
  busy: boolean;
}) {
  const cases = useRemote<CasePage>(
    "/api/investigations?limit=5",
    revision,
    2500,
  );
  const agents = useRemote<{ items: Agent[] }>(
    "/api/agents?limit=4",
    revision,
    5000,
  );
  return (
    <>
      <SectionHead
        tag="Security intelligence / Overview"
        title="The session ends. The knowledge stays."
        action={
          <button
            className="button primary"
            onClick={discover}
            disabled={busy || !d.memory.in_sync || !d.scope_enabled}
          >
            <Sparkles size={16} />
            Start fresh investigator
          </button>
        }
      >
        Connected evidence gives the next investigator a better starting point.
      </SectionHead>
      <div className="stats-grid">
        <div className="stat">
          <span>
            Current verified findings
            <Fingerprint size={16} />
          </span>
          <strong>{String(d.verified_current).padStart(2, "0")}</strong>
          <small>{d.verified_historical} historical receipts preserved</small>
        </div>
        <div className="stat">
          <span>
            Needs a human decision
            <GitBranch size={16} />
          </span>
          <strong>
            {String(
              (d.counts.awaiting_approval ?? 0) +
                (d.counts.awaiting_review ?? 0),
            ).padStart(2, "0")}
          </strong>
          <small>Approval and evidence review stay separate</small>
        </div>
        <div className="stat">
          <span>
            Independent agent sessions
            <Sparkles size={16} />
          </span>
          <strong>{String(d.model.sessions).padStart(2, "0")}</strong>
          <small>No conversation carried between sessions</small>
        </div>
        <div className="stat">
          <span>
            Lab executions
            <Database size={16} />
          </span>
          <strong>
            {d.budget.executions}
            <em> / {d.budget.execution_limit}</em>
          </strong>
          <small>Bounded per deployment revision</small>
        </div>
      </div>
      <div className="loop-banner">
        <div className="loop-intro">
          <p className="eyebrow">The continuing investigation loop</p>
          <h2>Evidence is the handoff.</h2>
          <p>
            A graph path proposes a question.
            <br />
            An authorized test provides an observation.
          </p>
        </div>
        <div className="loop-steps">
          {["Report", "Verify", "Remember", "Discover"].map((step, i) => (
            <div
              className={i === 2 ? "loop-step selected" : "loop-step"}
              key={step}
            >
              <span>0{i + 1}</span>
              <strong>{step}</strong>
              <small>
                {
                  [
                    "Researcher attribution",
                    "Test + human review",
                    "FalkorDB relationships",
                    "Fresh agent context",
                  ][i]
                }
              </small>
              {i < 3 && <ArrowRight className="step-arrow" size={15} />}
            </div>
          ))}
        </div>
      </div>
      {!d.memory.in_sync && (
        <ErrorNotice
          message={`Graph memory ${d.memory.available ? "has pending writes" : "is unavailable"}. Discovery and test admission fail closed. Pending events: ${d.memory.pending_events}.`}
        />
      )}
      <div className="two-column">
        <section className="panel">
          <header className="panel-head">
            <h2>Latest investigations</h2>
            <span className="muted">Live journal</span>
          </header>
          <ErrorNotice message={cases.error} />
          {cases.loading && !cases.data ? (
            <Loading />
          ) : cases.data?.items.length ? (
            <div className="case-list">
              {cases.data.items.map((c) => (
                <button
                  className="case-row"
                  key={c.id}
                  onClick={() => openCase(c.id)}
                >
                  <span className="case-mark">
                    <GitBranch size={16} />
                  </span>
                  <span className="case-copy">
                    <strong>{c.title}</strong>
                    <small>
                      {c.asset_id} <span>·</span> {c.origin} <span>·</span>{" "}
                      {c.revision}
                    </small>
                  </span>
                  <StateBadge state={c.state} stale={c.stale} />
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          ) : (
            <Empty title="Begin with one report">
              Submit a report for a registered synthetic test. No sample
              findings are pre-populated.
            </Empty>
          )}
        </section>
        <section className="panel">
          <header className="panel-head">
            <h2>Memory handoffs</h2>
            <span className="badge">
              {d.model.live_llm ? d.model.provider : "Deterministic mode"}
            </span>
          </header>
          <ErrorNotice message={agents.error} />
          {agents.data?.items.length ? (
            <div className="timeline">
              {agents.data.items.map((a) => (
                <div className="timeline-item" key={a.id}>
                  <span className="timeline-dot" />
                  <div>
                    <strong>
                      Fresh context · {a.status.replaceAll("_", " ")}
                    </strong>
                    <p>{a.reason}</p>
                    <small>
                      {formatDate(a.created_at)} · {a.previous_messages} prior
                      messages
                    </small>
                    {a.case_id && (
                      <button
                        className="text-button"
                        onClick={() => openCase(a.case_id!)}
                      >
                        Open hypothesis <ArrowUpRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Ready for a fresh investigator">
              Verify and review the first finding. Then start a new agent with
              only graph-retrieved context.
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
