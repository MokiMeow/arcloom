import { describe, expect, it } from "vitest";
import type { GraphNode, Link } from "../types";
import {
  layoutMemoryGraph,
  GRAPH_CARD_HEIGHT,
  GRAPH_CARD_WIDTH,
} from "./memoryGraph";

const node = (id: string, kind: string): GraphNode => ({ id, kind, props: {} });
const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

describe("memory graph geometry", () => {
  const nodes = [
    node("report", "Report"),
    node("finding", "Finding"),
    node("finding2", "Finding"),
    node("evidence", "Evidence"),
    node("future", "FutureKind"),
  ];
  const edges: Link[] = [
    { source: "report", target: "finding", relation: "BECAME" },
    { source: "report", target: "evidence", relation: "HAS_RECORDED_EVIDENCE" },
    { source: "evidence", target: "report", relation: "ATTRIBUTED_TO" },
    { source: "finding", target: "finding2", relation: "SUPERSEDES" },
    { source: "finding", target: "finding", relation: "SELF_REFERENCE" },
    {
      source: "future",
      target: "report",
      relation: "A_VERY_LONG_RELATIONSHIP_NAME_THAT_MUST_NOT_COVER_NODE_WORDS",
    },
  ];
  it("routes every segment outside every card for forward, reverse, same-kind and self links", () => {
    const layout = layoutMemoryGraph(nodes, edges);
    expect(layout.edges).toHaveLength(edges.length);
    for (const edge of layout.edges) {
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1],
          b = edge.points[i];
        expect(a.x === b.x || a.y === b.y).toBe(true);
        const segment = {
          x: Math.min(a.x, b.x) - 0.1,
          y: Math.min(a.y, b.y) - 0.1,
          width: Math.abs(a.x - b.x) + 0.2,
          height: Math.abs(a.y - b.y) + 0.2,
        };
        for (const card of layout.nodes)
          expect(
            overlaps(segment, {
              x: card.x + 1,
              y: card.y + 1,
              width: GRAPH_CARD_WIDTH - 2,
              height: GRAPH_CARD_HEIGHT - 2,
            }),
          ).toBe(false);
      }
      expect(edge.points.at(-1)?.x).toBe(
        layout.nodes.find((n) => n.id === edge.target)?.x,
      );
    }
  });
  it("reserves separate label lanes and keeps labels clear of all cards and other labels", () => {
    const layout = layoutMemoryGraph(nodes, edges);
    const labels = layout.edges.map((e) => ({
      x: e.labelX - e.labelWidth / 2,
      y: e.labelY - 13,
      width: e.labelWidth,
      height: 26,
    }));
    labels.forEach((label, i) => {
      for (const card of layout.nodes)
        expect(
          overlaps(label, {
            ...card,
            width: GRAPH_CARD_WIDTH,
            height: GRAPH_CARD_HEIGHT,
          }),
        ).toBe(false);
      for (const other of labels.slice(i + 1))
        expect(overlaps(label, other)).toBe(false);
    });
  });
  it("keeps unknown kinds in their own column and ignores missing endpoints", () => {
    const layout = layoutMemoryGraph(nodes, [
      ...edges,
      { source: "missing", target: "report", relation: "BROKEN" },
    ]);
    expect(layout.edges).toHaveLength(edges.length);
    expect(layout.nodes.find((n) => n.id === "future")?.x).toBeGreaterThan(
      layout.nodes.find((n) => n.id === "evidence")!.x,
    );
    expect(layoutMemoryGraph([], [])).toEqual({ nodes: [], edges: [] });
  });
  it("is stable when the API changes record ordering", () => {
    expect(
      layoutMemoryGraph([...nodes].reverse(), [...edges].reverse()),
    ).toEqual(layoutMemoryGraph(nodes, edges));
  });
  it("spreads repeated incoming arrows and outgoing connections along card borders", () => {
    const links = Array.from({ length: 8 }, (_, i) => ({
      source: "report",
      target: "finding",
      relation: `RELATION_${i}`,
    }));
    const layout = layoutMemoryGraph(nodes, links);
    const starts = layout.edges.map((e) => e.points[0]);
    const ends = layout.edges.map((e) => e.points.at(-1)!);
    expect(new Set(starts.map((p) => p.y)).size).toBe(links.length);
    expect(new Set(ends.map((p) => p.y)).size).toBe(links.length);
    for (const [id, points] of [
      ["report", starts],
      ["finding", ends],
    ] as const) {
      const card = layout.nodes.find((n) => n.id === id)!;
      for (const point of points) {
        expect(point.y).toBeGreaterThan(card.y + 20);
        expect(point.y).toBeLessThan(card.y + GRAPH_CARD_HEIGHT - 20);
        expect(point.x).toBe(
          id === "report" ? card.x + GRAPH_CARD_WIDTH : card.x,
        );
      }
    }
  });
  it("never reuses vertical stems when more than eight relationships share endpoints", () => {
    const links = Array.from({ length: 12 }, (_, i) => ({
      source: "report",
      target: "finding",
      relation: `RELATION_${i}`,
    }));
    const { edges } = layoutMemoryGraph(nodes, links);
    expect(new Set(edges.map((e) => e.points[1].x)).size).toBe(links.length);
    expect(new Set(edges.map((e) => e.points[4].x)).size).toBe(links.length);
  });
  it("keeps other relationship segments outside every label, including twelve parallel long labels", () => {
    const parallel = Array.from({ length: 12 }, (_, i) => ({
      source: "report",
      target: "finding",
      relation: `ATTRIBUTED_TO_LONG_RELATION_${i}`,
    }));
    const layout = layoutMemoryGraph(nodes, [...edges, ...parallel]);
    for (const label of layout.edges) {
      const bounds = {
        x: label.labelX - label.labelWidth / 2,
        y: label.labelY - 13,
        width: label.labelWidth,
        height: 26,
      };
      for (const edge of layout.edges.filter((e) => e.id !== label.id)) {
        for (let i = 1; i < edge.points.length; i++) {
          const a = edge.points[i - 1],
            b = edge.points[i];
          const segment = {
            x: Math.min(a.x, b.x) - 0.7,
            y: Math.min(a.y, b.y) - 0.7,
            width: Math.abs(a.x - b.x) + 1.4,
            height: Math.abs(a.y - b.y) + 1.4,
          };
          expect(
            overlaps(segment, bounds),
            `${edge.id} crosses ${label.id}`,
          ).toBe(false);
        }
      }
    }
  });
  it.each([8, 12, 24])(
    "keeps %i incoming arrowheads separate even when selection thickens edges",
    (count) => {
      const links = Array.from({ length: count }, (_, i) => ({
        source: "report",
        target: "finding",
        relation: `RELATION_${i}`,
      }));
      const { edges } = layoutMemoryGraph(nodes, links);
      const sorted = [...edges].sort(
        (a, b) => a.points.at(-1)!.y - b.points.at(-1)!.y,
      );
      for (const strokeWidth of [1.3, 2.2]) {
        sorted.forEach((edge, i) => {
          expect(edge.marker.markerUnits).toBe("userSpaceOnUse");
          const markerHeight =
            edge.marker.markerUnits === "userSpaceOnUse"
              ? edge.marker.height
              : edge.marker.height * strokeWidth;
          expect(markerHeight).toBeGreaterThan(0);
          expect(markerHeight).toBeLessThanOrEqual(18);
          if (i > 0)
            expect(markerHeight).toBeLessThanOrEqual(
              edge.points.at(-1)!.y - sorted[i - 1].points.at(-1)!.y + 0.00001,
            );
        });
      }
    },
  );
});
