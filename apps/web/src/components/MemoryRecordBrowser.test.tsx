// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import type { GraphData, GraphNode } from "../types";
import { Memory, MemoryRecordBrowser } from "./Memory";
import type { ReactNode } from "react";

const currentGraph = vi.hoisted(() => ({ data: null as GraphData | null }));
vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  useRemote: (path: string) => ({
    loading: false,
    error: null,
    data: path === "/api/memory" ? currentGraph.data : { items: [] },
  }),
}));
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@xyflow/react")>()),
  ReactFlow: ({
    nodes,
    onNodeClick,
    children,
  }: {
    nodes: { id: string }[];
    onNodeClick: (event: unknown, node: { id: string }) => void;
    children: ReactNode;
  }) => (
    <div>
      {nodes.length > 0 && (
        <button onClick={() => onNodeClick({}, nodes[0])}>
          Select fixture graph node
        </button>
      )}
      {children}
    </div>
  ),
  Controls: () => null,
  Background: () => null,
  Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
  useReactFlow: () => ({
    viewportInitialized: false,
    fitBounds: vi.fn(),
    getNodes: () => [],
    getEdges: () => [],
    setCenter: vi.fn(),
  }),
  useStore: (
    selector: (state: {
      nodeLookup: Map<string, unknown>;
      width: number;
      height: number;
    }) => unknown,
  ) => selector({ nodeLookup: new Map(), width: 0, height: 0 }),
}));
afterEach(cleanup);

const records: GraphNode[] = [
  {
    id: "finding_current",
    kind: "Finding",
    props: { title: "Current gateway finding", current: true },
  },
  {
    id: "finding_historical",
    kind: "Finding",
    props: { title: "Earlier gateway finding", current: false },
  },
  {
    id: "capability_invoice",
    kind: "Capability",
    props: { title: "Invoice access" },
  },
];

it("exposes full readable record names, current/historical status, and the selected inspector target", () => {
  const selectRecord = vi.fn();
  render(
    <MemoryRecordBrowser
      records={records}
      selectedId="finding_current"
      selectRecord={selectRecord}
      focused={false}
    />,
  );
  const current = screen.getByRole("button", {
    name: "Inspect record Finding: Current gateway finding",
  });
  expect(current).toHaveAttribute("aria-pressed", "true");
  expect(current).toHaveAttribute("aria-controls", "memory-inspector");
  expect(current).toHaveTextContent("Verified · current");
  const historical = screen.getByRole("button", {
    name: "Inspect record Finding: Earlier gateway finding",
  });
  expect(historical).toHaveAttribute("aria-pressed", "false");
  expect(historical).toHaveTextContent("Historical · revalidate");
  fireEvent.click(historical);
  expect(selectRecord).toHaveBeenCalledExactlyOnceWith(records[1]);
  expect(screen.getByText("Whole workspace")).toBeVisible();
});

it("combines record ID search and type filters without selecting or changing graph records", () => {
  const selectRecord = vi.fn();
  render(
    <MemoryRecordBrowser
      records={records}
      selectRecord={selectRecord}
      focused
    />,
  );
  fireEvent.change(screen.getByLabelText("Filter graph records"), {
    target: { value: "finding_" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("2 of 3 records");
  fireEvent.change(screen.getByLabelText("Filter graph record type"), {
    target: { value: "Capability" },
  });
  expect(
    screen.getByRole("heading", { name: "No matching graph records" }),
  ).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("0 of 3 records");
  fireEvent.change(screen.getByLabelText("Filter graph records"), {
    target: { value: "invoice" },
  });
  expect(
    screen.getByRole("button", {
      name: "Inspect record Capability: Invoice access",
    }),
  ).toBeVisible();
  expect(screen.getByText("Focused investigation")).toBeVisible();
  expect(selectRecord).not.toHaveBeenCalled();
  expect(records).toHaveLength(3);
});

it("paginates large graphs and resets the page when a filter narrows the record set", () => {
  const assets = Array.from({ length: 27 }, (_, index) => ({
    id: `asset_${index}`,
    kind: "Asset",
    props: { title: `Synthetic asset ${String(index).padStart(2, "0")}` },
  }));
  render(
    <MemoryRecordBrowser
      records={assets}
      selectRecord={vi.fn()}
      focused={false}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Previous records" }),
  ).toBeDisabled();
  expect(
    screen.getAllByRole("button", { name: /^Inspect record/ }),
  ).toHaveLength(25);
  fireEvent.click(screen.getByRole("button", { name: "Next records" }));
  expect(
    screen.getAllByRole("button", { name: /^Inspect record/ }),
  ).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Next records" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Filter graph records"), {
    target: { value: "Synthetic asset 00" },
  });
  expect(
    screen.getByRole("button", {
      name: "Inspect record Asset: Synthetic asset 00",
    }),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Next records" })).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("1 of 27 records");
});

it("preserves an entire long record ID and title as readable text and an accessible description", () => {
  const identifier = `evidence_${"0123456789abcdef".repeat(4)}_original_artifact_suffix`;
  const title =
    "A very long evidence record title that must remain available to a researcher on a narrow screen without relying on a hover tooltip";
  render(
    <MemoryRecordBrowser
      records={[{ id: identifier, kind: "Evidence", props: { title } }]}
      selectRecord={vi.fn()}
      focused={false}
    />,
  );
  const button = screen.getByRole("button", {
    name: `Inspect record Evidence: ${title}`,
  });
  expect(button).toHaveAccessibleDescription(identifier);
  expect(screen.getByText(title, { exact: true })).toBeVisible();
  expect(screen.getByText(identifier, { exact: true })).toHaveClass(
    "full-identifier-value",
  );
  fireEvent.change(screen.getByLabelText("Filter graph records"), {
    target: { value: "original_artifact_suffix" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("1 of 1 records");
});

it("refreshes a selected inspector from current graph data and clears removed records", () => {
  currentGraph.data = {
    engine: "FalkorDB",
    graph_name: "fixture",
    nodes: [records[0]],
    edges: [],
    selection_query: "MATCH (n) RETURN n",
    warning: "",
  };
  const { rerender } = render(<Memory revision={0} openCase={vi.fn()} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Select fixture graph node" }),
  );
  const inspector = screen.getByRole("complementary", {
    name: "Memory inspector",
  });
  expect(inspector).toHaveTextContent("Current gateway finding");
  currentGraph.data = {
    ...currentGraph.data,
    nodes: [
      {
        ...records[0],
        props: {
          title: "Historical gateway finding after revision change",
          current: false,
        },
      },
    ],
  };
  rerender(<Memory revision={1} openCase={vi.fn()} />);
  expect(inspector).toHaveTextContent(
    "Historical gateway finding after revision change",
  );
  expect(inspector).not.toHaveTextContent("Current gateway finding");
  currentGraph.data = { ...currentGraph.data, nodes: [] };
  rerender(<Memory revision={2} openCase={vi.fn()} />);
  expect(inspector).toHaveTextContent("Select a graph node");
  expect(inspector).not.toHaveTextContent(
    "Historical gateway finding after revision change",
  );
});
