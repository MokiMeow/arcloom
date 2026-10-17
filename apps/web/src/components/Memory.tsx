import { useEffect, useMemo, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Database, Maximize2 } from "lucide-react";
import { useRemote } from "../api";
import type { CasePage, GraphData, GraphNode } from "../types";
import { Empty, ErrorNotice, Loading, SectionHead } from "./ui";

import { GraphInsights } from "./GraphInsights";

const order = [
  "Report",
  "Finding",
  "Capability",
  "TestCase",
  "Asset",
  "Hypothesis",
  "AgentSession",
  "TestRun",
  "Review",
  "Evidence",
  "Revision",
  "TrustBoundary",
];
export function Memory({
  revision,
  openCase,
}: {
  revision: number;
  openCase: (id: string) => void;
}) {
  const graph = useRemote<GraphData>("/api/memory", revision, 0);
  const cases = useRemote<CasePage>(
    "/api/investigations?limit=100",
    revision,
    0,
  );
  const [focus, setFocus] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized && cases.data) {
      setFocus(cases.data.items.find((c) => c.path.length > 0)?.id ?? "");
      setInitialized(true);
    }
  }, [cases.data, initialized]);
  const filtered = useMemo(() => {
    const c = cases.data?.items.find((item) => item.id === focus);
    const ids = new Set(c?.path.flatMap((e) => [e.source, e.target]) ?? []);
    if (c) ids.add(c.id);
    const sourceNodes =
      graph.data?.nodes.filter((n) => !ids.size || ids.has(n.id)) ?? [];
    const kinds = order.filter((kind) =>
      sourceNodes.some((n) => n.kind === kind),
    );
    const rows: Record<string, number> = {};
    const nodes: Node[] = sourceNodes.map((n) => {
      const row = rows[n.kind] ?? 0;
      rows[n.kind] = row + 1;
      const current = n.kind === "Finding" && n.props.current === true;
      return {
        id: n.id,
        position: { x: kinds.indexOf(n.kind) * 255, y: row * 135 },
        data: {
          label: (
            <div className="graph-node">
              <span>{n.kind}</span>
              <strong>{String(n.props.title ?? n.id)}</strong>
              <small>
                {n.kind === "Finding"
                  ? current
                    ? "Verified · current"
                    : "Historical · revalidate"
                  : n.kind === "Hypothesis"
                    ? String(n.props.state).replaceAll("_", " ")
                    : n.id}
              </small>
            </div>
          ),
        },
        style: {
          width: 217,
          border: `1px solid ${current ? "#087c68" : n.kind === "Hypothesis" ? "#b88a3b" : "#cdd5d0"}`,
          borderRadius: 7,
          background: current
            ? "#f1fbf6"
            : n.kind === "Hypothesis"
              ? "#fffbf0"
              : "#ffffff",
          textAlign: "left",
          padding: 0,
        },
        sourcePosition: undefined,
        targetPosition: undefined,
      };
    });
    const actualIds = new Set(sourceNodes.map((n) => n.id));
    const edges: Edge[] = (graph.data?.edges ?? [])
      .filter((e) => actualIds.has(e.source) && actualIds.has(e.target))
      .map((e) => ({
        id: `${e.source}:${e.relation}:${e.target}`,
        source: e.source,
        target: e.target,
        label: e.relation,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#849790", strokeWidth: 1.3 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#849790" },
        labelStyle: { fontSize: 9, fill: "#43534c" },
        labelBgPadding: [5, 3],
      }));
    return { nodes, edges };
  }, [graph.data, cases.data, focus]);
  return (
    <>
      <SectionHead
        tag="FalkorDB / Connected memory"
        title="Show the path behind the next question."
      >
        These are persisted graph records, not a drawing of what the agent
        claims to remember.
      </SectionHead>
      <ErrorNotice message={graph.error || cases.error} />
      {graph.loading && !graph.data ? (
        <Loading />
      ) : graph.data ? (
        <>
          <div className="graph-toolbar">
            <span>
              <Database size={16} />
              {graph.data.engine}{" "}
              <span className="badge">
                {graph.data.nodes.length} nodes · {graph.data.edges.length}{" "}
                relationships
              </span>
            </span>
            <label>
              Focus
              <select
                aria-label="Graph focus"
                value={focus}
                onChange={(e) => {
                  setFocus(e.target.value);
                  setSelected(null);
                }}
              >
                <option value="">Whole workspace</option>
                {cases.data?.items
                  .filter((c) => c.path.length > 0)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="graph-layout">
            <div
              className="graph-canvas"
              aria-label="Interactive FalkorDB memory graph"
            >
              <ReactFlow
                key={focus + filtered.nodes.length}
                nodes={filtered.nodes}
                edges={filtered.edges}
                fitView
                fitViewOptions={{ padding: 0.22 }}
                minZoom={0.15}
                maxZoom={1.6}
                nodesDraggable={true}
                nodesConnectable={false}
                edgesReconnectable={false}
                onNodeClick={(_, n) =>
                  setSelected(
                    graph.data!.nodes.find((item) => item.id === n.id) ?? null,
                  )
                }
                proOptions={{ hideAttribution: false }}
              >
                <Background gap={22} size={1} />
                <Controls showInteractive={false} />
              </ReactFlow>
              <div className="graph-hint">
                <Maximize2 size={13} />
                Pan, zoom, or select a node to inspect its source.
              </div>
            </div>
            <aside className="panel padded graph-inspector">
              <p className="eyebrow">Memory inspector</p>
              {selected ? (
                <>
                  <span className="badge">{selected.kind}</span>
                  <h2>{String(selected.props.title ?? selected.id)}</h2>
                  <code className="break-all">{selected.id}</code>
                  <dl className="property-list">
                    {Object.entries(selected.props).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k.replaceAll("_", " ")}</dt>
                        <dd>
                          {typeof v === "object"
                            ? JSON.stringify(v)
                            : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {typeof selected.props.case_id === "string" && (
                    <button
                      className="button"
                      onClick={() => openCase(String(selected.props.case_id))}
                    >
                      Open source investigation
                    </button>
                  )}
                </>
              ) : (
                <Empty title="Select a graph node">
                  Inspect its persisted properties, evidence reference, and
                  revision.
                </Empty>
              )}
              <div className="notice compact">
                A relationship proposes a hypothesis. It does not prove an
                executable chain.
              </div>
            </aside>
          </div>
          <GraphInsights
            key={revision}
            nodes={graph.data.nodes}
            selectNode={setSelected}
          />
          <details className="panel query-panel">
            <summary>Inspect the actual candidate-selection Cypher</summary>
            <p className="muted">
              All required capabilities must have current, verified support.
              Tests already attempted at this revision are excluded.
            </p>
            <pre>{graph.data.selection_query}</pre>
            <p className="muted">
              Bound parameters: revision and source_finding_id. Graph names come
              from the authenticated workspace, never from the agent.
            </p>
          </details>
        </>
      ) : null}
    </>
  );
}
