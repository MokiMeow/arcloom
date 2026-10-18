// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoffPacket } from "../types";
import { HandoffBrief } from "./HandoffBrief";

const { remote, useRemote } = vi.hoisted(() => ({
  remote: {
    data: null as HandoffPacket | null,
    error: null as string | null,
    loading: false,
  },
  useRemote: vi.fn(),
}));
vi.mock("../api", () => ({ useRemote }));
const hash = "a".repeat(64);
const packet: HandoffPacket = {
  schemaVersion: 1,
  workspace: { tenant: "Lab", revision: "r1" },
  graph: { engine: "FalkorDB", in_sync: true },
  audit: { valid: true, checked: 12, head_hash: hash },
  summary: {
    confirmed_current: 1,
    negative_current: 0,
    inconclusive_current: 0,
    eligible_followups: 1,
  },
  findings: [
    {
      id: "finding_one",
      case_id: "case_one",
      title: "Internal route exposed",
      asset_id: "gateway",
      revision: "r1",
      depth: 0,
      evidence: {
        artifact_id: "artifact_one",
        sha256: hash,
        run_id: "run_one",
        signature_verified: true,
      },
      capabilities: ["internal-route-access"],
    },
  ],
  candidates: [
    {
      test_id: "invoice-chain",
      title: "Inspect invoice chain",
      asset_id: "invoices",
      depth: 1,
      requires: ["internal-route-access"],
      finding_ids: ["finding_one"],
      paths: [
        [
          {
            source: "finding_one",
            relation: "ENABLES",
            target: "internal-route-access",
          },
          {
            source: "invoice-chain",
            relation: "REQUIRES",
            target: "internal-route-access",
          },
        ],
      ],
    },
  ],
  observations: [
    {
      case_id: "case_negative",
      test_id: "boundary",
      title: "Boundary remains closed",
      state: "not_reproduced",
      outcome: "not_reproduced",
      revision: "r1",
    },
  ],
  blocked: [
    {
      test_id: "a",
      title: "Initial route",
      reason: "already_attempted",
      missing_capabilities: [],
    },
    {
      test_id: "b",
      title: "Unknown route",
      reason: "initial_report_required",
      missing_capabilities: [],
    },
    {
      test_id: "c",
      title: "Tenant chain",
      reason: "missing_prerequisites",
      missing_capabilities: ["cross-tenant-invoice-read"],
    },
    {
      test_id: "d",
      title: "Deep path",
      reason: "depth_limit",
      missing_capabilities: [],
    },
  ],
  packet_sha256: "b".repeat(64),
};
beforeEach(() => {
  remote.data = structuredClone(packet);
  remote.error = null;
  remote.loading = false;
  useRemote.mockImplementation(() => remote);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(browserToolsAvailable = false) {
  const openCase = vi.fn();
  const openMemory = vi.fn();
  const result = render(
    <HandoffBrief
      revision={3}
      openCase={openCase}
      openMemory={openMemory}
      browserToolsAvailable={browserToolsAvailable}
    />,
  );
  return { ...result, openCase, openMemory };
}
describe("structured memory handoff", () => {
  it("loads once per revision without an audit polling interval", () => {
    setup();
    expect(useRemote).toHaveBeenCalledWith("/api/memory/handoff", 3);
    expect(screen.getByText("r1")).toBeVisible();
    expect(screen.getByText("verified finding")).toBeVisible();
    expect(screen.getByText("eligible follow-up")).toBeVisible();
    expect(
      screen.queryByText(/Browser agent tools available/),
    ).not.toBeInTheDocument();
  });
  it("shows evidence hashes, named support links, and actual graph path labels on expansion", () => {
    const { openCase, openMemory } = setup();
    fireEvent.click(screen.getByText("Verified evidence"));
    expect(screen.getByText(hash)).toBeVisible();
    expect(screen.getByText("Receipt signature verified")).toBeVisible();
    fireEvent.click(
      screen.getAllByRole("button", { name: "Internal route exposed" })[0],
    );
    expect(openCase).toHaveBeenLastCalledWith("case_one");
    fireEvent.click(screen.getByText("Graph-supported follow-ups"));
    expect(screen.getByText("Requires: internal-route-access")).toBeVisible();
    fireEvent.click(screen.getByText("Supporting graph paths"));
    expect(screen.getByText("enables")).toBeVisible();
    expect(screen.getByText("requires")).toBeVisible();
    const links = screen.getAllByRole("button", {
      name: "Internal route exposed",
    });
    fireEvent.click(links[1]);
    expect(openCase).toHaveBeenLastCalledWith("case_one");
    fireEvent.click(screen.getByRole("button", { name: "Explore memory" }));
    expect(openMemory).toHaveBeenCalledOnce();
  });
  it("explains every blocked state and preserves negative observations", () => {
    const { openCase } = setup();
    fireEvent.click(screen.getByText("Why other tests wait"));
    for (const text of [
      "Already attempted on this revision",
      "An initial report is required",
      "Supporting evidence is still needed",
      "Investigation depth limit reached",
      "Missing: cross-tenant-invoice-read",
    ])
      expect(screen.getByText(text)).toBeVisible();
    fireEvent.click(screen.getByText("Recorded observations"));
    fireEvent.click(
      screen.getByRole("button", { name: "Boundary remains closed" }),
    );
    expect(openCase).toHaveBeenCalledWith("case_negative");
  });
  it("exports the actual packet including its SHA-256 and releases the download URL", async () => {
    let exported!: Blob;
    const createObjectURL = vi.fn((blob: Blob) => {
      exported = blob;
      return "blob:handoff";
    });
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Export handoff" }));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:handoff");
    expect(document.querySelector("a[download]")).toBeNull();
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(exported);
    });
    expect(JSON.parse(text)).toEqual(packet);
  });
  it("makes an empty workspace understandable without inventing findings", () => {
    remote.data = {
      ...packet,
      summary: {
        ...packet.summary,
        confirmed_current: 0,
        eligible_followups: 0,
      },
      findings: [],
      candidates: [],
      observations: [],
    };
    setup();
    expect(
      screen.getByText(/No verified findings on this revision yet/),
    ).toBeVisible();
    expect(
      screen.queryByText("Internal route exposed"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export handoff" }),
    ).toBeEnabled();
  });
  it("disables export while missing, loading, or a retained snapshot fails refresh", () => {
    remote.data = null;
    const view = setup();
    expect(
      screen.getByRole("button", { name: "Export handoff" }),
    ).toBeDisabled();
    remote.data = packet;
    remote.error = "Evidence artifact is unavailable.";
    view.rerender(
      <HandoffBrief revision={4} openCase={vi.fn()} openMemory={vi.fn()} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Evidence artifact is unavailable.",
    );
    expect(
      screen.getByRole("button", { name: "Export handoff" }),
    ).toBeDisabled();
    expect(screen.getByText("Snapshot awaiting refresh")).toBeVisible();
  });
  it("rejects unverified or malformed evidence instead of claiming verification", () => {
    remote.data!.findings[0].evidence.signature_verified = false;
    setup();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This handoff could not be verified",
    );
    expect(
      screen.queryByText("Receipt signature verified"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Export handoff" }),
    ).toBeDisabled();
  });
  it("shows browser agent availability only after actual registration", () => {
    setup(true);
    expect(screen.getByText(/Browser agent tools available/)).toBeVisible();
  });
});
