import { useState } from "react";
import { request, errorText } from "../api";
import type { GraphNode } from "../types";
import { ErrorNotice } from "./ui";

type Requirement = { capability: string; before: string[]; after: string[] };
type Withdrawal = {
  revision: string;
  withdrawn_findings: string[];
  supported_before: number;
  supported_after: number;
  lost_support: number;
  assumptions: string[];
  paths: { finding_id: string; title: string; path: string[] }[];
  tests: {
    test_id: string;
    title: string;
    supported_before: boolean;
    supported_after: boolean;
    requirements: Requirement[];
  }[];
  queries: Record<string, string>;
};
type Diagnostics = {
  plan: string;
  warning: string;
  centrality: { asset_id: string; title: string; score: number }[];
};
type Search = { items: (GraphNode & { score: number })[]; truncated: boolean };

export function GraphInsights({
  nodes,
  selectNode,
}: {
  nodes: GraphNode[];
  selectNode: (node: GraphNode) => void;
}) {
  const [text, setText] = useState("");
  const [found, setFound] = useState<Search | null>(null);
  const [root, setRoot] = useState("");
  const [analysis, setAnalysis] = useState<Withdrawal | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const findings = nodes.filter(
    (n) => n.kind === "Finding" && n.props.current === true,
  );
  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel padded stack graph-insights"
      aria-label="Graph intelligence tools"
    >
      <header>
        <p className="eyebrow">FalkorDB / Inspect and challenge the memory</p>
        <h2>Inspect the evidence. Challenge its support.</h2>
        <p className="muted">
          Search real graph records, then see which prerequisites depend on a
          finding.
        </p>
      </header>
      <ErrorNotice message={error} />
      {busy && (
        <p className="muted" role="status">
          Querying graph memory…
        </p>
      )}
      <div className="insight-grid">
        <form
          className="stack insight-tool"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              setFound(
                await request<Search>(
                  `/api/memory/search?q=${encodeURIComponent(text)}`,
                ),
              );
            });
          }}
        >
          <label>
            Search persisted graph memory
            <input
              aria-label="Search graph memory"
              value={text}
              maxLength={100}
              onChange={(e) => setText(e.target.value)}
              placeholder="invoice"
              required
            />
          </label>
          <button className="button" disabled={busy}>
            Search graph
          </button>
          {found && (
            <div className="stack" aria-live="polite">
              <span className="muted">
                {found.items.length} indexed matches
                {found.truncated ? " · more matches omitted" : ""}. Relevance is
                not proof.
              </span>
              {found.items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className="text-button"
                  onClick={() => selectNode(n)}
                >
                  {String(n.props.title ?? n.id)} · {n.kind}
                </button>
              ))}
            </div>
          )}
        </form>
        <div className="stack insight-tool">
          <label>
            Finding to withdraw
            <select
              aria-label="Finding to withdraw"
              disabled={busy}
              value={root}
              onChange={(e) => {
                setRoot(e.target.value);
                setAnalysis(null);
              }}
            >
              <option value="">Choose a current finding</option>
              {findings.map((n) => (
                <option key={n.id} value={n.id}>
                  {String(n.props.title ?? n.id)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button"
            disabled={busy || !root}
            onClick={() =>
              void perform(async () => {
                setAnalysis(
                  await request<Withdrawal>(
                    `/api/memory/withdrawal?finding_id=${encodeURIComponent(root)}`,
                  ),
                );
              })
            }
          >
            Run withdrawal analysis
          </button>
          <p className="muted">
            Read-only experiment. No graph nodes are deleted and no tests are
            executed.
          </p>
        </div>
      </div>
      {analysis && (
        <div className="stack" aria-live="polite">
          <p className="notice">
            Supported test prerequisites: {analysis.supported_before} before →{" "}
            {analysis.supported_after} after. {analysis.lost_support} test(s)
            lose support. Revision {analysis.revision}.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Registered test</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {analysis.tests.map((t) => (
                  <tr key={t.test_id}>
                    <td>{t.title}</td>
                    <td>
                      {t.supported_before
                        ? "Supported"
                        : "Missing prerequisites"}
                    </td>
                    <td>
                      {t.supported_after
                        ? "Independent support remains"
                        : "Missing prerequisites"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>
              Inspect affected provenance paths and alternative evidence
            </summary>
            {analysis.paths.map((p, i) => (
              <p key={`${p.finding_id}:${i}`}>
                <strong>{p.title}</strong>
                <br />
                <code className="break-all">{p.path.join(" → ")}</code>
              </p>
            ))}
            <pre>
              {JSON.stringify(
                analysis.tests.map((t) => ({
                  test: t.test_id,
                  requirements: t.requirements,
                })),
                null,
                2,
              )}
            </pre>
          </details>
          <details>
            <summary>Analysis assumptions and exact Cypher</summary>
            {analysis.assumptions.map((s) => (
              <p className="muted" key={s}>
                {s}
              </p>
            ))}
            {Object.entries(analysis.queries).map(([name, q]) => (
              <div key={name}>
                <h3>{name}</h3>
                <pre>{q}</pre>
              </div>
            ))}
          </details>
        </div>
      )}
      <button
        className="button"
        disabled={busy}
        onClick={() =>
          void perform(async () => {
            setDiagnostics(
              await request<Diagnostics>("/api/memory/diagnostics"),
            );
          })
        }
      >
        Inspect native query plan and PageRank
      </button>
      {diagnostics && (
        <details open>
          <summary>Native FalkorDB diagnostics</summary>
          <p className="muted">
            GRAPH.EXPLAIN builds the plan without executing the
            candidate-selection query.
          </p>
          <pre>{diagnostics.plan}</pre>
          <h3>Dependency importance</h3>
          {diagnostics.centrality.map((a) => (
            <p key={a.asset_id}>
              {a.title}: {a.score.toFixed(6)}
            </p>
          ))}
          <p className="muted">{diagnostics.warning}</p>
        </details>
      )}
    </section>
  );
}
