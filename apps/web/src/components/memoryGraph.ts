import type { GraphNode, Link } from "../types";

export const GRAPH_CARD_WIDTH = 280;
export const GRAPH_CARD_HEIGHT = 164;
const COLUMN_GAP = 340;
const LABEL_LANE = 40;
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

export interface GraphPoint {
  x: number;
  y: number;
}
export interface RoutedRelationship extends Link {
  id: string;
  points: GraphPoint[];
  path: string;
  labelX: number;
  labelY: number;
  labelWidth: number;
  caption: string;
  marker: { markerUnits: "userSpaceOnUse"; width: number; height: number };
}

/** Reserve horizontal lanes between rows and vertical gutters between columns.
 * Unlike smoothstep routing, a reverse or same-kind link cannot cross a card.
 * Keep cards fixed: moving one would invalidate the shared obstacle geometry. */
export function layoutMemoryGraph(
  sourceNodes: GraphNode[],
  sourceEdges: Link[],
) {
  const kinds = [...new Set(sourceNodes.map((n) => n.kind))].sort((a, b) => {
    const rank = (kind: string) =>
      order.includes(kind) ? order.indexOf(kind) : order.length;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const rows = new Map<string, number>();
  const cards = [...sourceNodes]
    .sort(
      (a, b) =>
        kinds.indexOf(a.kind) - kinds.indexOf(b.kind) ||
        a.id.localeCompare(b.id),
    )
    .map((n) => {
      const row = rows.get(n.kind) ?? 0;
      rows.set(n.kind, row + 1);
      return {
        id: n.id,
        x: kinds.indexOf(n.kind) * (GRAPH_CARD_WIDTH + COLUMN_GAP),
        y: 0,
        row,
      };
    });
  const byId = new Map(cards.map((n) => [n.id, n]));
  const links = sourceEdges
    .filter((e) => byId.has(e.source) && byId.has(e.target))
    .sort((a, b) =>
      `${a.source}:${a.relation}:${a.target}`.localeCompare(
        `${b.source}:${b.relation}:${b.target}`,
      ),
    );
  const rowCounts = new Map<number, number>();
  links.forEach((e) => {
    const row = byId.get(e.source)!.row;
    rowCounts.set(row, (rowCounts.get(row) ?? 0) + 1);
  });
  const rowTops: number[] = [];
  let top = 0;
  for (let row = 0; row < Math.max(0, ...rows.values()); row++) {
    rowTops.push(top);
    top += GRAPH_CARD_HEIGHT + 84 + (rowCounts.get(row) ?? 0) * LABEL_LANE;
  }
  cards.forEach((n) => {
    n.y = rowTops[n.row];
  });
  const rowSlots = new Map<number, number>();
  const incomingCounts = new Map<string, number>();
  const outgoingCounts = new Map<string, number>();
  const incomingSlots = new Map<string, number>();
  const outgoingSlots = new Map<string, number>();
  links.forEach((e) => {
    incomingCounts.set(e.target, (incomingCounts.get(e.target) ?? 0) + 1);
    outgoingCounts.set(e.source, (outgoingCounts.get(e.source) ?? 0) + 1);
  });
  const portY = (
    id: string,
    counts: Map<string, number>,
    slots: Map<string, number>,
  ) => {
    const slot = (slots.get(id) ?? 0) + 1;
    slots.set(id, slot);
    return (
      byId.get(id)!.y +
      24 +
      (slot * (GRAPH_CARD_HEIGHT - 48)) / (counts.get(id)! + 1)
    );
  };
  const edges: RoutedRelationship[] = links.map((e, index) => {
    const source = byId.get(e.source)!,
      target = byId.get(e.target)!;
    const slot = rowSlots.get(source.row) ?? 0;
    rowSlots.set(source.row, slot + 1);
    const laneY = source.y + GRAPH_CARD_HEIGHT + 42 + slot * LABEL_LANE;
    const sourceX = source.x + GRAPH_CARD_WIDTH,
      targetX = target.x;
    // Stay within the outside 40px of a gutter: its centered 252px label
    // leaves 44px on either side. Unique stems also remain clear of labels.
    const offset = 28 + ((index + 1) * 12) / (links.length + 1);
    const sourceY = portY(e.source, outgoingCounts, outgoingSlots);
    const targetY = portY(e.target, incomingCounts, incomingSlots);
    const points = [
      { x: sourceX, y: sourceY },
      { x: sourceX + offset, y: sourceY },
      { x: sourceX + offset, y: laneY },
      { x: targetX - offset, y: laneY },
      { x: targetX - offset, y: targetY },
      { x: targetX, y: targetY },
    ];
    const caption =
      e.relation.length > 28 ? `${e.relation.slice(0, 27)}…` : e.relation;
    const markerSize = Math.min(
      18,
      (GRAPH_CARD_HEIGHT - 48) / (incomingCounts.get(e.target)! + 1),
    );
    return {
      ...e,
      id: `${e.source}:${e.relation}:${e.target}:${index}`,
      points,
      path: points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" "),
      labelX: (points[2].x + points[3].x) / 2,
      labelY: laneY,
      labelWidth: Math.min(252, caption.length * 8 + 20),
      caption,
      marker: {
        markerUnits: "userSpaceOnUse",
        width: markerSize,
        height: markerSize,
      },
    };
  });
  return { nodes: cards.map(({ row: _row, ...card }) => card), edges };
}
