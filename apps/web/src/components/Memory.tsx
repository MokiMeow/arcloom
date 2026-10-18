import { useEffect, useMemo, useState } from "react";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Panel,
  MarkerType,
  Position,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import type { Edge, EdgeProps, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Database } from "lucide-react";
import { useRemote } from "../api";
import type { CasePage, GraphData, GraphNode } from "../types";
import { Empty, ErrorNotice, Loading, SectionHead } from "./ui";

import { GraphInsights } from "./GraphInsights";
import {
  GRAPH_CARD_HEIGHT,
  GRAPH_CARD_WIDTH,
  layoutMemoryGraph,
} from "./memoryGraph";
import type { RoutedRelationship } from "./memoryGraph";

type MemoryEdge = Edge<{ route: RoutedRelationship }>;
function RelationshipEdge({
  id,
  data,
  markerEnd,
  style,
}: EdgeProps<MemoryEdge>) {
  const route = data!.route;
  return (
    <>
      <g>
        <title>{route.relation}</title>
        <BaseEdge
          id={id}
          path={route.path}
          markerEnd={markerEnd}
          style={style}
        />
      </g>
      <EdgeLabelRenderer>
        <span
          className="graph-edge-label"
          title={route.relation}
          style={{
            width: route.labelWidth,
            transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)`,
          }}
        >
          {route.caption}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { relationship: RelationshipEdge };
function GraphViewControls({ selectedId }: { selectedId?: string }) {
  const { fitBounds, getNodes, getEdges, setCenter } = useReactFlow<
    Node,
    MemoryEdge
  >();
  return (
    <Panel position="top-right" className="graph-view-controls">
      <button
        type="button"
        onClick={() => {
          const cards = getNodes();
          const routes = getEdges().flatMap((e) => e.data?.route.points ?? []);
          if (!cards.length) return;
          const left = Math.min(
            ...cards.map((n) => n.position.x),
            ...routes.map((p) => p.x),
          );
          const top = Math.min(
            ...cards.map((n) => n.position.y),
            ...routes.map((p) => p.y),
          );
          const right = Math.max(
            ...cards.map((n) => n.position.x + GRAPH_CARD_WIDTH),
            ...routes.map((p) => p.x),
          );
          const bottom = Math.max(
            ...cards.map((n) => n.position.y + GRAPH_CARD_HEIGHT),
            ...routes.map((p) => p.y + 20),
          );
          void fitBounds(
            { x: left, y: top, width: right - left, height: bottom - top },
            { padding: 0.18 },
          );
        }}
      >
        Fit graph
      </button>
      <button
        type="button"
        onClick={() => {
          const cards = getNodes();
          const card =
            cards.find((n) => n.id === selectedId) ??
            cards.sort(
              (a, b) =>
                a.position.x - b.position.x || a.position.y - b.position.y,
            )[0];
          if (card)
            void setCenter(
              card.position.x + GRAPH_CARD_WIDTH / 2,
              card.position.y + GRAPH_CARD_HEIGHT / 2,
              { zoom: 1 },
            );
        }}
      >
        Read labels
      </button>
    </Panel>
  );
}
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
    const geometry = layoutMemoryGraph(sourceNodes, graph.data?.edges ?? []);
    const positions = new Map(
      geometry.nodes.map((n) => [n.id, { x: n.x, y: n.y }]),
    );
    const nodes: Node[] = sourceNodes.map((n) => {
      const current = n.kind === "Finding" && n.props.current === true;
      return {
        id: n.id,
        position: positions.get(n.id)!,
        selected: selected?.id === n.id,
        ariaRole: "button",
        ariaLabel: `Inspect ${n.kind}: ${String(n.props.title ?? n.id)}`,
        data: {
          label: (
            <div className="graph-node">
              <span>{n.kind}</span>
              <strong title={String(n.props.title ?? n.id)}>
                {String(n.props.title ?? n.id)}
              </strong>
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
          width: GRAPH_CARD_WIDTH,
          height: GRAPH_CARD_HEIGHT,
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
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    });
    const edges: MemoryEdge[] = geometry.edges.map((route) => {
      const highlighted =
        selected?.id === route.source || selected?.id === route.target;
      const stroke = highlighted ? "#176b58" : "#91a29a";
      return {
        id: route.id,
        source: route.source,
        target: route.target,
        type: "relationship",
        data: { route },
        style: { stroke, strokeWidth: highlighted ? 2.2 : 1.3 },
        zIndex: highlighted ? 1 : 0,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          ...route.marker,
        },
      };
    });
    return { nodes, edges };
  }, [graph.data, cases.data, focus, selected?.id]);
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
          <p className="graph-help">
            Relationships have their own lanes. Select a card to inspect it; use
            Read labels for full size, then pan to follow the path.
          </p>
          <div className="graph-layout">
            <div
              className="graph-canvas"
              aria-label="Interactive FalkorDB memory graph"
            >
              <ReactFlow
                key={focus + filtered.nodes.length}
                nodes={filtered.nodes}
                onNodesChange={(changes) => {
                  const selection = changes.find(
                    (change) => change.type === "select" && change.selected,
                  );
                  if (selection?.type === "select")
                    setSelected(
                      graph.data!.nodes.find((n) => n.id === selection.id) ??
                        null,
                    );
                  else if (changes.some((change) => change.type === "select"))
                    setSelected(null);
                }}
                edgeTypes={edgeTypes}
                edges={filtered.edges}
                fitView
                fitViewOptions={{ padding: 0.18, minZoom: 0.5, maxZoom: 0.9 }}
                minZoom={0.08}
                maxZoom={1.6}
                nodesDraggable={false}
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
                <Controls showInteractive={false} showFitView={false} />
                <GraphViewControls selectedId={selected?.id} />
              </ReactFlow>
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
                  <div className="graph-relationships">
                    <h3>Connected relationships</h3>
                    <ul>
                      {graph.data.edges
                        .filter(
                          (e) =>
                            e.source === selected.id ||
                            e.target === selected.id,
                        )
                        .map((e, i) => (
                          <li
                            key={`${e.source}:${e.relation}:${e.target}:${i}`}
                          >
                            <strong>{e.relation}</strong>
                            <span>
                              {e.source === selected.id ? "To" : "From"}{" "}
                              {e.source === selected.id ? e.target : e.source}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </div>
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
