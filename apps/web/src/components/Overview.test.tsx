// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "../types";
import { Overview } from "./Overview";

vi.mock("../api", () => ({
  useRemote: (path: string) => ({
    data: path === "/api/memory/handoff" ? null : { items: [] },
    error: null,
    loading: false,
  }),
}));
afterEach(cleanup);
const dashboard: Dashboard = {
  workspace: "Lab",
  revision: "r1",
  revision_title: "Original",
  scope_enabled: true,
  scope_expires_at: 9999999999,
  counts: {},
  findings: [],
  verified_current: 0,
  verified_historical: 0,
  memory: {
    engine: "FalkorDB",
    available: true,
    pending_events: 0,
    in_sync: true,
  },
  budget: {
    executions: 0,
    execution_limit: 40,
    model_calls: 0,
    model_call_limit: 40,
  },
  model: {
    provider: "deterministic",
    model: "policy",
    live_llm: false,
    input_tokens: 0,
    output_tokens: 0,
    sessions: 0,
  },
  worker: { enabled: true, last_tick: null, last_error: null },
  synthetic: true,
  at: 0,
};
function setup(d = dashboard, canWrite = true, canDiscover = canWrite) {
  const newReport = vi.fn();
  const discover = vi.fn();
  const openInvestigations = vi.fn();
  render(
    <Overview
      dashboard={d}
      revision={0}
      openCase={vi.fn()}
      discover={discover}
      busy={false}
      canWrite={canWrite}
      canDiscover={canDiscover}
      newReport={newReport}
      openMemory={vi.fn()}
      openInvestigations={openInvestigations}
    />,
  );
  return { newReport, discover, openInvestigations };
}
describe("overview next action", () => {
  it.each([true, false])(
    "does not grant reviewer actions from report access (%s)",
    (canWrite) => {
      setup(
        { ...dashboard, counts: { confirmed: 1 }, verified_current: 1 },
        canWrite,
        false,
      );
      const button = screen.getByRole("button", {
        name: "Start fresh investigator",
      });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        "title",
        "A reviewer or owner can start an investigator.",
      );
    },
  );
  it("disables fresh investigation until an initial report exists", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Start fresh investigator" }),
    ).toBeDisabled();
  });
  it("lets an empty workspace start its first report directly", () => {
    const { newReport } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Submit first report" }),
    );
    expect(newReport).toHaveBeenCalledOnce();
  });
  it("offers viewers a readable workflow without report creation", () => {
    setup(dashboard, false);
    expect(
      screen.queryByRole("button", { name: "Submit first report" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Ask a researcher to submit/)).toBeVisible();
  });
  it("sends pending human decisions to the investigation queue", () => {
    const { openInvestigations } = setup({
      ...dashboard,
      counts: { awaiting_review: 2 },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Open decision queue" }),
    );
    expect(openInvestigations).toHaveBeenCalledOnce();
  });
});
