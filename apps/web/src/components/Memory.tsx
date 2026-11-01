import { useCallback, useEffect, useId, useMemo, useState } from "react";
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
  useStore,
} from "@xyflow/react";
import type { Edge, EdgeProps, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowUpRight, Database, Search } from "lucide-react";
import { useRemote } from "../api";
import type { CasePage, GraphData, GraphNode } from "../types";
import { Empty, ErrorNotice, Loading, SectionHead } from "./ui";

import { GraphInsights } from "./GraphInsights";
import { FullIdentifier } from "./FullIdentifier";
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

export function MemoryRecordBrowser({
  records,
  selectedId,
  selectRecord,
  focused,
}: {
  records: GraphNode[];
  selectedId?: string;
  selectRecord: (record: GraphNode) => void;
  focused: boolean;
}) {
  const browserId = useId();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(0);
  const kinds = [...new Set(records.map((record) => record.kind))].sort();
  const normalized = query.trim().toLowerCase();
  const matching = records.filter(
    (record) =>
      (!kind || kind === record.kind) &&
      `${record.kind} ${record.id} ${String(record.props.title ?? "")}`
        .toLowerCase()
        .includes(normalized),
  );
  const pageSize = 25;
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(matching.length / pageSize) - 1),
  );
  const visible = matching.slice(
    currentPage * pageSize,
    (currentPage + 1) * pageSize,
  );
  return (
    <section className="panel graph-record-browser" aria-label="Graph records">
      <header className="panel-head">
        <div>
          <h2>Browse graph records</h2>
          <p className="muted">
            A readable alternative to the canvas. Select a record to inspect its
            persisted properties and relationships.
          </p>
        </div>
        <span className="badge">
          {focused ? "Focused investigation" : "Whole workspace"}
        </span>
      </header>
      <div className="graph-record-filters">
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Filter graph records"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Filter by title, type or record ID"
          />
        </label>
        <select
          aria-label="Filter graph record type"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setPage(0);
          }}
        >
          <option value="">Every record type</option>
          {kinds.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className="muted" role="status">
          {matching.length} of {records.length} records
        </span>
      </div>
      {visible.length ? (
        <ul className="graph-record-list">
          {visible.map((record, index) => (
            <li key={record.id}>
              <button
                type="button"
                className="graph-record-row"
                aria-label={`Inspect record ${record.kind}: ${String(record.props.title ?? record.id)}`}
                aria-pressed={record.id === selectedId}
                aria-describedby={`${browserId}-record-${index}`}
                aria-controls="memory-inspector"
                onClick={() => selectRecord(record)}
              >
                <span className="graph-record-type">{record.kind}</span>
                <span className="graph-record-copy">
                  <strong>{String(record.props.title ?? record.id)}</strong>
                  <code
                    className="full-identifier-value"
                    id={`${browserId}-record-${index}`}
                  >
                    {record.id}
                  </code>
                </span>
                {record.kind === "Finding" && (
                  <span className="badge">
                    {record.props.current === true
                      ? "Verified · current"
                      : "Historical · revalidate"}
                  </span>
                )}
                <ArrowUpRight size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No matching graph records">
          Try another title, type or record ID. Filtering does not change the
          graph or its prerequisites.
        </Empty>
      )}
      {matching.length > pageSize && (
        <div className="pagination">
          <button
            type="button"
            className="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous records
          </button>
          <span>
            {currentPage * pageSize + 1}–
            {Math.min((currentPage + 1) * pageSize, matching.length)} of{" "}
            {matching.length}
          </span>
          <button
            type="button"
            className="button"
            disabled={(currentPage + 1) * pageSize >= matching.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Next records
          </button>
        </div>
      )}
    </section>
  );
}

function GraphViewControls({ selectedId }: { selectedId?: string }) {
  const { fitBounds, getNodes, getEdges, setCenter, viewportInitialized } =
    useReactFlow<Node, MemoryEdge>();
  const nodeCount = useStore((state) => state.nodeLookup.size);
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const fitGraph = useCallback(() => {
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
  }, [fitBounds, getNodes, getEdges]);
  useEffect(() => {
    if (!viewportInitialized || !nodeCount || width <= 0 || height <= 0) return;
    const frame = requestAnimationFrame(fitGraph);
    return () => cancelAnimationFrame(frame);
  }, [viewportInitialized, nodeCount, width, height, fitGraph]);
  return (
    <Panel position="top-right" className="graph-view-controls">
      <button type="button" onClick={fitGraph}>
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
  const [selection, setSelected] = useState<GraphNode | null>(null);
  // Resolve current data on every refresh; do not retain stale finding properties.
  const selected =
    graph.data?.nodes.find((record) => record.id === selection?.id) ?? null;
  const [initialized, setInitialized] = useState(false);
  const focusedCase = cases.data?.items.find((item) => item.id === focus);
  function inspectRecord(record: GraphNode) {
    setSelected(record);
    requestAnimationFrame(() => {
      const inspector = document.getElementById("memory-inspector");
      inspector?.focus({ preventScroll: true });
      inspector?.scrollIntoView({ block: "nearest" });
    });
  }
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
          border: `1px solid ${current ? "#078564" : n.kind === "Finding" ? "#c08b40" : n.kind === "Hypothesis" ? "#818cf8" : "#cbd5e1"}`,
          borderRadius: 6,
          background: current
            ? "#f0fdf7"
            : n.kind === "Finding"
              ? "#fffbeb"
              : n.kind === "Hypothesis"
                ? "#f5f5ff"
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
      const stroke = highlighted ? "#6366f1" : "#94a3b8";
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
    return { nodes, edges, records: sourceNodes };
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
          {focusedCase && (
            <div className="graph-focus-title">
              <span>Focused investigation</span>
              <strong>{focusedCase.title}</strong>
              <FullIdentifier
                value={focusedCase.id}
                label="focused investigation ID"
              />
            </div>
          )}
          <p className="graph-help">
            {focus
              ? "Showing the selected investigation’s supporting path. "
              : "Showing the loaded workspace graph. "}
            Use Read labels for full size, or browse the searchable record list
            below. Selecting a record does not change eligibility.
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
                fitViewOptions={{ padding: 0.18, minZoom: 0.02, maxZoom: 0.9 }}
                minZoom={0.02}
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
            <aside
              className="panel padded graph-inspector"
              id="memory-inspector"
              tabIndex={-1}
              aria-label="Memory inspector"
            >
              <p className="eyebrow">Memory inspector</p>
              {selected ? (
                <>
                  <span className="badge">{selected.kind}</span>
                  <h2>{String(selected.props.title ?? selected.id)}</h2>
                  <FullIdentifier value={selected.id} label="graph record ID" />
                  <dl className="property-list">
                    {Object.entries(selected.props).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k.replaceAll("_", " ")}</dt>
                        <dd>
                          {typeof v === "string" &&
                          /(^id$|_id$|hash|sha256)/i.test(k) ? (
                            <FullIdentifier
                              value={v}
                              label={k.replaceAll("_", " ")}
                            />
                          ) : typeof v === "object" ? (
                            JSON.stringify(v)
                          ) : (
                            String(v)
                          )}
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
                              {e.source === selected.id ? "To" : "From"}
                            </span>
                            <FullIdentifier
                              value={
                                e.source === selected.id ? e.target : e.source
                              }
                              label="related graph record ID"
                            />
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
          <MemoryRecordBrowser
            key={focus}
            records={filtered.records}
            selectedId={selected?.id}
            selectRecord={inspectRecord}
            focused={Boolean(focus)}
          />
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
            <pre tabIndex={0} aria-label="Graph query and diagnostics">
              {graph.data.selection_query}
            </pre>
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
