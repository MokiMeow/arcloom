import {
  ArrowRight,
  ArrowUpRight,
  Database,
  Fingerprint,
  GitBranch,
  CircleCheck,
  FilePlus2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Dashboard, CasePage, Agent } from "../types";
import { useRemote } from "../api";
import { HandoffBrief } from "./HandoffBrief";
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
  canWrite,
  canDiscover,
  newReport,
  openMemory,
  openInvestigations,
  browserToolsAvailable = false,
}: {
  dashboard: Dashboard;
  revision: number;
  openCase: (id: string) => void;
  discover: () => void;
  busy: boolean;
  canWrite: boolean;
  canDiscover: boolean;
  newReport: () => void;
  openMemory: () => void;
  openInvestigations: () => void;
  browserToolsAvailable?: boolean;
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
  const decisions =
    (d.counts.awaiting_approval ?? 0) + (d.counts.awaiting_review ?? 0);
  const hasReports = Object.values(d.counts).some((count) => count > 0);
  const nextAction =
    decisions > 0 ? "review" : !hasReports ? "report" : "discover";
  const discoveryBlocked = !canDiscover
    ? "A reviewer or owner can start an investigator."
    : !hasReports
      ? "Submit the first report before starting a fresh investigator."
      : !d.memory.in_sync
        ? "Graph memory must be synchronized first."
        : !d.scope_enabled
          ? "Execution admission is paused."
          : busy
            ? "An investigator is already running."
            : undefined;
  return (
    <>
      <div className="overview-dateline">
        <span className="eyebrow">Your investigation workspace</span>
        <span className="mono">
          {new Date(d.at * 1000).toLocaleDateString(undefined, {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
        </span>
      </div>
      <SectionHead
        tag="Security intelligence / Overview"
        title="Investigation overview"
        action={
          <button
            className="button primary"
            onClick={discover}
            disabled={
              !canDiscover ||
              busy ||
              !hasReports ||
              !d.memory.in_sync ||
              !d.scope_enabled
            }
            title={discoveryBlocked}
          >
            <Sparkles size={16} />
            Start fresh investigator
          </button>
        }
      >
        The session ends. The knowledge stays. Pick up the next thread.
      </SectionHead>
      <div className="stats-grid">
        <div className="stat">
          <span>
            Current verified findings
            <Fingerprint size={16} />
          </span>
          <strong>{String(d.verified_current).padStart(2, "0")}</strong>
          <small>{d.verified_historical} total findings retained</small>
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
      <HandoffBrief
        key={d.revision}
        revision={revision}
        openCase={openCase}
        openMemory={openMemory}
        browserToolsAvailable={browserToolsAvailable}
      />
      <section className="next-action" aria-label="Next workspace action">
        <span className="next-action-icon">
          {nextAction === "review" ? (
            <ShieldCheck size={24} />
          ) : nextAction === "report" ? (
            <FilePlus2 size={24} />
          ) : (
            <CircleCheck size={24} />
          )}
        </span>
        <div>
          <span className="eyebrow">
            {nextAction === "review" ? "Your attention is needed" : "Next step"}
          </span>
          <h2>
            {nextAction === "review"
              ? `${decisions} ${decisions === 1 ? "decision is" : "decisions are"} waiting for a human.`
              : nextAction === "report"
                ? "Build your first evidence trail."
                : "Continue from what you know."}
          </h2>
          <p>
            {nextAction === "review"
              ? "Inspect the scope or recorded evidence before moving an investigation forward."
              : nextAction === "report"
                ? canWrite
                  ? "Start with an observation from the registered lab. Verification comes next."
                  : "Ask a researcher to submit the first lab observation. You can follow every decision here."
                : "Open the memory graph to inspect the supporting paths, or start a fresh investigator."}
          </p>
        </div>
        {nextAction === "review" ? (
          <button className="button primary" onClick={openInvestigations}>
            Open decision queue <ArrowRight size={15} />
          </button>
        ) : nextAction === "report" ? (
          canWrite && (
            <button className="button primary" onClick={newReport}>
              Submit first report <ArrowRight size={15} />
            </button>
          )
        ) : (
          <button className="button" onClick={openMemory}>
            Inspect memory <ArrowRight size={15} />
          </button>
        )}
      </section>
      {!d.memory.in_sync && (
        <ErrorNotice
          message={`Graph memory ${d.memory.available ? "has pending writes" : "is unavailable"}. Discovery and test admission fail closed. Pending events: ${d.memory.pending_events}.`}
        />
      )}
      <div className="two-column">
        <section className="panel">
          <header className="panel-head">
            <h2>Latest investigations</h2>
            <button className="text-button" onClick={openInvestigations}>
              View all <ArrowUpRight size={14} />
            </button>
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
              {d.model.decision_model
                ? "Cloudflare decision model"
                : d.model.live_llm
                  ? d.model.provider
                  : "Deterministic mode"}
            </span>
          </header>
          <ErrorNotice message={agents.error} />
          {agents.loading && !agents.data ? (
            <Loading />
          ) : agents.data?.items.length ? (
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
              {d.verified_current > 0
                ? "Start a fresh investigator with the current graph's supported follow-ups. No previous conversation is carried."
                : "Verify and review the first finding. Then start a new agent with only graph-retrieved context."}
            </Empty>
          )}
        </section>
      </div>
    </>
  );
}
