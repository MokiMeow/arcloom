import {
  ArrowRight,
  ArrowUpRight,
  Download,
  Network,
  ShieldCheck,
} from "lucide-react";
import { useRemote } from "../api";
import type { HandoffPacket } from "../types";
import { ErrorNotice, Loading } from "./ui";

const blockedReasons: Record<string, string> = {
  already_attempted: "Already attempted on this revision",
  initial_report_required: "An initial report is required",
  report_required: "An initial report is required",
  missing_prerequisites: "Supporting evidence is still needed",
  depth_limit: "Investigation depth limit reached",
};

function usable(packet: HandoffPacket): boolean {
  return (
    packet.schemaVersion === 1 &&
    !!packet.workspace?.revision &&
    packet.graph?.in_sync === true &&
    packet.audit?.valid === true &&
    !!packet.summary &&
    typeof packet.packet_sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(packet.packet_sha256) &&
    Array.isArray(packet.findings) &&
    Array.isArray(packet.candidates) &&
    Array.isArray(packet.observations) &&
    Array.isArray(packet.blocked) &&
    packet.findings.every(
      (finding) =>
        finding.evidence?.signature_verified === true &&
        /^[a-f0-9]{64}$/.test(finding.evidence.sha256) &&
        typeof finding.title === "string" &&
        typeof finding.case_id === "string" &&
        Array.isArray(finding.capabilities),
    ) &&
    packet.candidates.every(
      (candidate) =>
        Array.isArray(candidate.requires) &&
        Array.isArray(candidate.finding_ids) &&
        Array.isArray(candidate.paths) &&
        candidate.paths.every(
          (path) =>
            Array.isArray(path) &&
            path.every(
              (link) =>
                typeof link.source === "string" &&
                typeof link.relation === "string" &&
                typeof link.target === "string",
            ),
        ),
    ) &&
    packet.blocked.every((item) => Array.isArray(item.missing_capabilities))
  );
}

function download(packet: HandoffPacket): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `arcloom-handoff-${packet.workspace.revision.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    URL.revokeObjectURL(url);
  }
}

export function HandoffBrief({
  revision,
  openCase,
  openMemory,
  browserToolsAvailable = false,
}: {
  revision: number;
  openCase: (id: string) => void;
  openMemory: () => void;
  browserToolsAvailable?: boolean;
}) {
  const remote = useRemote<HandoffPacket>("/api/memory/handoff", revision);
  const packet = remote.data && usable(remote.data) ? remote.data : null;
  const invalid = remote.data && !packet;
  // A failed refresh must not present the retained snapshot as a current handoff.
  const current = packet && !remote.error && !remote.loading ? packet : null;
  return (
    <section className="panel handoff-brief" aria-labelledby="handoff-heading">
      <div className="handoff-intro">
        <div>
          <p className="eyebrow">
            <Network size={15} /> Structured memory / Agent handoff
          </p>
          <h2 id="handoff-heading">The next investigator starts here.</h2>
          <p>
            A fresh agent reads verified findings and their supporting graph
            paths. Approval and evidence review remain separate human decisions.
          </p>
        </div>
        <button
          className="button"
          onClick={() => current && download(current)}
          disabled={!current}
        >
          <Download size={15} /> Export handoff
        </button>
      </div>
      <ErrorNotice message={remote.error} />
      {remote.error && (
        <div className="handoff-retry">
          <button className="text-button" onClick={() => void remote.refresh()}>
            Retry handoff <ArrowRight size={14} />
          </button>
        </div>
      )}
      {invalid && (
        <ErrorNotice message="This handoff could not be verified. Refresh the workspace or inspect activity and evidence before continuing." />
      )}
      {remote.loading && !remote.data && <Loading />}
      {packet && (
        <>
          <div className="handoff-summary">
            <div>
              <span className="eyebrow">Deployment revision</span>
              <strong className="mono">{packet.workspace.revision}</strong>
              <small>
                {current
                  ? "FalkorDB synchronized · audit valid"
                  : "Snapshot awaiting refresh"}
              </small>
            </div>
            <div>
              <strong>{packet.summary.confirmed_current}</strong>
              <span>
                verified{" "}
                {packet.summary.confirmed_current === 1
                  ? "finding"
                  : "findings"}
              </span>
            </div>
            <ArrowRight size={20} aria-hidden="true" />
            <div>
              <strong>{packet.summary.eligible_followups}</strong>
              <span>
                eligible{" "}
                {packet.summary.eligible_followups === 1
                  ? "follow-up"
                  : "follow-ups"}
              </span>
            </div>
          </div>
          {packet.findings.length === 0 && (
            <p className="handoff-empty">
              No verified findings on this revision yet. Submit a report, then
              complete approval and evidence review to give the next
              investigator a supported starting point.
            </p>
          )}
          <div className="handoff-sections">
            <details>
              <summary>
                Verified evidence <span>{packet.findings.length}</span>
              </summary>
              {packet.findings.length === 0 ? (
                <p>No current verified evidence to pass on.</p>
              ) : (
                packet.findings.map((finding) => (
                  <article className="handoff-record" key={finding.id}>
                    <button
                      className="text-button handoff-case"
                      onClick={() => openCase(finding.case_id)}
                    >
                      {finding.title}
                      <ArrowUpRight size={14} />
                    </button>
                    <small>
                      {finding.asset_id} · {finding.revision} · depth{" "}
                      {finding.depth}
                    </small>
                    <p className="handoff-verified">
                      <ShieldCheck size={14} /> Receipt signature verified
                    </p>
                    <dl>
                      <dt>Receipt SHA-256</dt>
                      <dd>
                        <code>{finding.evidence.sha256}</code>
                      </dd>
                      <dt>Run / artifact</dt>
                      <dd>
                        <code>
                          {finding.evidence.run_id} /{" "}
                          {finding.evidence.artifact_id}
                        </code>
                      </dd>
                    </dl>
                    {finding.capabilities.length > 0 && (
                      <p>Enables: {finding.capabilities.join(", ")}</p>
                    )}
                  </article>
                ))
              )}
            </details>
            <details>
              <summary>
                Graph-supported follow-ups{" "}
                <span>{packet.candidates.length}</span>
              </summary>
              {packet.candidates.length === 0 ? (
                <p>No eligible follow-ups in the current graph.</p>
              ) : (
                packet.candidates.map((candidate) => (
                  <article className="handoff-record" key={candidate.test_id}>
                    <h3>{candidate.title}</h3>
                    <small>
                      {candidate.asset_id} · depth {candidate.depth}
                    </small>
                    <p>
                      Requires:{" "}
                      {candidate.requires.join(", ") ||
                        "No prerequisite capabilities"}
                    </p>
                    <div className="handoff-support">
                      <span>Supported by</span>
                      {candidate.finding_ids.map((id) => {
                        const finding = packet.findings.find(
                          (item) => item.id === id,
                        );
                        return finding ? (
                          <button
                            className="text-button"
                            key={id}
                            onClick={() => openCase(finding.case_id)}
                          >
                            {finding.title}
                            <ArrowUpRight size={13} />
                          </button>
                        ) : (
                          <code key={id}>{id}</code>
                        );
                      })}
                    </div>
                    <details className="handoff-paths">
                      <summary>
                        Supporting graph paths{" "}
                        <span>{candidate.paths.length}</span>
                      </summary>
                      {candidate.paths.map((path, i) => (
                        <ol key={i} aria-label={`Graph path ${i + 1}`}>
                          {path.map((link, j) => (
                            <li key={j}>
                              <code>{link.source}</code>
                              <span>
                                {link.relation
                                  .replaceAll("_", " ")
                                  .toLowerCase()}
                              </span>
                              <code>{link.target}</code>
                            </li>
                          ))}
                        </ol>
                      ))}
                    </details>
                  </article>
                ))
              )}
            </details>
            <details>
              <summary>
                Why other tests wait <span>{packet.blocked.length}</span>
              </summary>
              {packet.blocked.length === 0 ? (
                <p>No blocked tests in this handoff.</p>
              ) : (
                packet.blocked.map((item) => (
                  <article className="handoff-record" key={item.test_id}>
                    <h3>{item.title}</h3>
                    <p>
                      {blockedReasons[item.reason] ??
                        item.reason.replaceAll("_", " ")}
                    </p>
                    {item.missing_capabilities.length > 0 && (
                      <small>
                        Missing: {item.missing_capabilities.join(", ")}
                      </small>
                    )}
                  </article>
                ))
              )}
            </details>
            {packet.observations.length > 0 && (
              <details>
                <summary>
                  Recorded observations{" "}
                  <span>{packet.observations.length}</span>
                </summary>
                <p>
                  Observations preserve negative and inconclusive results. They
                  do not confer verified capabilities.
                </p>
                {packet.observations.map((observation) => (
                  <article className="handoff-record" key={observation.case_id}>
                    <button
                      className="text-button"
                      onClick={() => openCase(observation.case_id)}
                    >
                      {observation.title}
                      <ArrowUpRight size={14} />
                    </button>
                    <small>
                      {observation.revision} ·{" "}
                      {observation.state.replaceAll("_", " ")}
                      {observation.outcome
                        ? ` · ${observation.outcome.replaceAll("_", " ")}`
                        : ""}
                    </small>
                  </article>
                ))}
              </details>
            )}
          </div>
          <div className="handoff-footer">
            <button className="text-button" onClick={openMemory}>
              Explore memory <ArrowRight size={14} />
            </button>
            <span className="footnote">
              {packet.audit.checked} audit events checked · JSON includes packet
              SHA-256
            </span>
          </div>
        </>
      )}
      {!remote.loading && !remote.data && !remote.error && (
        <p className="handoff-empty">No handoff packet is available yet.</p>
      )}
      {browserToolsAvailable && (
        <p className="footnote handoff-browser-tools">
          Browser agent tools available · read-only workspace access
        </p>
      )}
    </section>
  );
}
