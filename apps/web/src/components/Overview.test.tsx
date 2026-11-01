// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEvent, Case, CasePage, Dashboard, Events } from "../types";
import { Overview } from "./Overview";
import { dashboardLayoutKey, defaultDashboardLayout } from "./dashboardLayout";

const queue = vi.hoisted(() => ({
  data: { items: [], total: 0, limit: 100, offset: 0 } as CasePage | null,
  error: null as string | null,
  loading: false,
}));
const audit = vi.hoisted(() => ({
  data: { items: [], cursor: 0, has_more: false } as Events | null,
  error: null as string | null,
  loading: false,
}));
vi.mock("../api", () => ({
  useRemote: (path: string) =>
    path.startsWith("/api/investigations")
      ? queue
      : path.startsWith("/api/events")
        ? audit
        : {
            data: path === "/api/memory/handoff" ? null : { items: [] },
            error: null,
            loading: false,
          },
}));
beforeEach(() => {
  window.localStorage.clear();
  queue.data = { items: [], total: 0, limit: 100, offset: 0 };
  queue.error = null;
  queue.loading = false;
  audit.data = { items: [], cursor: 0, has_more: false };
  audit.error = null;
  audit.loading = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
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
function setup(
  d = dashboard,
  canWrite = true,
  canDiscover = canWrite,
  layoutOwner?: string,
) {
  const newReport = vi.fn();
  const discover = vi.fn();
  const openInvestigations = vi.fn();
  const openCase = vi.fn();
  render(
    <Overview
      dashboard={d}
      layoutOwner={layoutOwner}
      revision={0}
      openCase={openCase}
      discover={discover}
      busy={false}
      canWrite={canWrite}
      canDiscover={canDiscover}
      newReport={newReport}
      openMemory={vi.fn()}
      openInvestigations={openInvestigations}
    />,
  );
  return { newReport, discover, openInvestigations, openCase };
}
function investigation(id: string, state: Case["state"], title: string): Case {
  return {
    id,
    state,
    title,
    test_id: "gateway-boundary",
    asset_id: "gateway",
    revision: "r1",
    origin: "report",
    researcher: "Researcher Mira",
    reason: "Lab observation",
    supports: [],
    path: [],
    depth: 0,
    stale: false,
    created_at: 100,
    updated_at: 200,
  };
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
  it("filters actual loaded rows without inflating loaded counts from global totals", () => {
    queue.data = {
      items: [
        investigation("approval", "awaiting_approval", "Routing boundary"),
        investigation("review", "awaiting_review", "Invoice isolation"),
        investigation("active", "running", "Export isolation"),
      ],
      total: 30,
      limit: 100,
      offset: 0,
    };
    const { openCase } = setup({
      ...dashboard,
      counts: { awaiting_approval: 23, awaiting_review: 4, running: 3 },
    });
    expect(
      within(screen.getByLabelText("Workspace totals")).getByText("27"),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "All: 3 loaded investigations" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Evidence review: 1 loaded investigations",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Invoice isolation" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Routing boundary" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invoice isolation" }));
    expect(openCase).toHaveBeenCalledWith("review");
    expect(screen.getByText("1 shown · 3 loaded of 30")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Active: 1 loaded investigations" }),
    );
    expect(
      screen.getByRole("button", { name: "Export isolation" }),
    ).toBeVisible();
  });
  it("searches loaded titles, assets and researchers and can clear an empty filter", () => {
    queue.data = {
      items: [
        investigation("approval", "awaiting_approval", "Routing boundary"),
      ],
      total: 1,
      limit: 100,
      offset: 0,
    };
    setup({ ...dashboard, counts: { awaiting_approval: 1 } });
    const search = screen.getByRole("textbox", {
      name: "Search loaded investigations",
    });
    fireEvent.change(search, { target: { value: "mira" } });
    expect(
      screen.getByRole("button", { name: "Routing boundary" }),
    ).toBeVisible();
    fireEvent.change(search, { target: { value: "nonexistent" } });
    expect(screen.getByText("No cases match these filters")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(search).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Routing boundary" }),
    ).toBeVisible();
  });
  it("keeps fetched rows visible while refresh fails instead of presenting an empty queue", () => {
    queue.data = {
      items: [
        investigation("approval", "awaiting_approval", "Routing boundary"),
      ],
      total: 1,
      limit: 100,
      offset: 0,
    };
    queue.error = "Could not refresh investigations.";
    setup();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not refresh investigations.",
    );
    expect(
      screen.getByRole("button", { name: "Routing boundary" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Your investigation queue starts here"),
    ).not.toBeInTheDocument();
  });
  it("distinguishes initial loading and a failed queue request from a genuinely empty queue", () => {
    queue.data = null;
    queue.loading = true;
    setup();
    expect(
      within(
        screen.getByRole("region", { name: "Investigation queue" }),
      ).getByRole("status"),
    ).toHaveTextContent("Loading workspace");
    expect(
      screen.queryByText("Your investigation queue starts here"),
    ).not.toBeInTheDocument();
  });
  it("explains an unavailable queue while retaining global workspace totals", () => {
    queue.data = null;
    queue.error = "Queue is unavailable.";
    setup({ ...dashboard, verified_current: 2 });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Queue is unavailable.",
    );
    expect(screen.getByText(/The queue could not be loaded/)).toBeVisible();
    expect(
      within(screen.getByLabelText("Workspace totals")).getByText("02"),
    ).toBeVisible();
    expect(
      screen.queryByText("Your investigation queue starts here"),
    ).not.toBeInTheDocument();
  });
  it.each([100, 101])(
    "blocks expired scope using payload server time %s",
    (at) => {
      const { discover } = setup({
        ...dashboard,
        counts: { confirmed: 1 },
        scope_enabled: true,
        scope_expires_at: 100,
        at,
      });
      const button = screen.getByRole("button", {
        name: "Start fresh investigator",
      });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        "title",
        "The assessment has expired. Ask the workspace owner to review assessment configuration.",
      );
      expect(screen.getByText("Assessment expired")).toBeVisible();
      fireEvent.click(button);
      expect(discover).not.toHaveBeenCalled();
    },
  );
  it("keeps an enabled but unexpired server assessment open and a paused scope distinct", () => {
    setup({
      ...dashboard,
      counts: { confirmed: 1 },
      scope_expires_at: 100,
      at: 50,
    });
    expect(
      screen.getByRole("button", { name: "Start fresh investigator" }),
    ).toBeEnabled();
    expect(screen.getByText("Open · approval required")).toBeVisible();
  });
  it("does not admit discovery when graph availability is false despite a stale sync flag", () => {
    setup({
      ...dashboard,
      counts: { confirmed: 1 },
      memory: { ...dashboard.memory, available: false, in_sync: true },
    });
    expect(
      screen.getByRole("button", { name: "Start fresh investigator" }),
    ).toBeDisabled();
    expect(screen.getByText("Unavailable")).toBeVisible();
  });
  it("groups loaded journal events by UTC day for the selected window and preserves source limits", () => {
    const at = Date.UTC(2026, 9, 29, 12) / 1000;
    const lastDay = Math.floor(at / 86400) * 86400;
    const event = (seq: number, time: number): AuditEvent => ({
      seq,
      kind: "case.reported",
      object_id: "case_a",
      actor: "researcher",
      at: time,
      payload: {},
      event_hash: "sha256",
    });
    audit.data = {
      items: [
        event(1, lastDay - 14 * 86400),
        event(2, lastDay - 6 * 86400),
        event(3, lastDay - 1),
        event(4, lastDay + 3600),
        event(5, lastDay + 86400),
      ],
      cursor: 5,
      has_more: true,
    };
    setup({ ...dashboard, at });
    const chart = screen.getByRole("img", {
      name: "Loaded audit events by UTC day",
    });
    expect(chart).toHaveAccessibleDescription(/3 loaded audit events/);
    expect(screen.getByText(/Additional history is available/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    expect(chart).toHaveAccessibleDescription(/4 loaded audit events/);
    fireEvent.click(screen.getByRole("button", { name: "7 days" }));
    expect(chart).toHaveAccessibleDescription(/3 loaded audit events/);
    const inspector = screen.getByRole("slider", { name: "Inspect a day" });
    fireEvent.change(inspector, { target: { value: "0" } });
    expect(inspector).toHaveAttribute(
      "aria-valuetext",
      "October 23, 2026: 1 loaded events",
    );
    fireEvent.click(screen.getByText("View daily event counts"));
    const table = screen.getByRole("table", {
      name: "First loaded audit page, grouped by UTC date",
    });
    expect(
      within(table).getByRole("row", { name: "October 28, 2026 1" }),
    ).toBeVisible();
    expect(
      within(table).getByRole("row", { name: "October 29, 2026 1" }),
    ).toBeVisible();
  });
  it("reports no loaded events in a window without inventing activity", () => {
    setup({ ...dashboard, at: Date.UTC(2026, 9, 29, 12) / 1000 });
    expect(
      screen.getByRole("img", { name: "Loaded audit events by UTC day" }),
    ).toHaveAccessibleDescription(/0 loaded audit events/);
    expect(
      screen.getByText("No loaded audit events fall in this window."),
    ).toBeVisible();
    expect(
      screen.getByRole("slider", { name: "Inspect a day" }),
    ).toHaveAttribute("aria-valuetext", "October 29, 2026: 0 loaded events");
  });
  it("distinguishes missing audit data from zero audit events", () => {
    audit.data = null;
    audit.error = "Audit page unavailable.";
    setup();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Audit page unavailable.",
    );
    expect(
      screen.queryByRole("img", { name: "Loaded audit events by UTC day" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Audit activity could not be loaded/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Export snapshot" }),
    ).toBeDisabled();
  });
  it("can switch from global workflow counts to the explicitly loaded asset sample", () => {
    queue.data = {
      items: [
        investigation("a", "awaiting_approval", "Routing boundary"),
        {
          ...investigation("b", "confirmed", "Invoice isolation"),
          asset_id: "invoice",
        },
      ],
      total: 50,
      limit: 100,
      offset: 0,
    };
    setup({ ...dashboard, counts: { confirmed: 35, awaiting_approval: 15 } });
    const composition = screen.getByRole("region", {
      name: "Case composition",
    });
    expect(
      within(composition).getByText("50 cases across all workspace states"),
    ).toBeVisible();
    fireEvent.click(
      within(composition).getByRole("button", { name: "Loaded assets" }),
    );
    expect(
      within(composition).getByText("2 loaded cases grouped by asset"),
    ).toBeVisible();
    expect(within(composition).getByText("gateway")).toBeVisible();
    expect(within(composition).getByText("invoice")).toBeVisible();
    expect(
      within(composition).getByText(/Asset counts apply to the loaded/),
    ).toBeVisible();
  });
  it("exports the actual dashboard and loaded records with source and time-window metadata", async () => {
    const objects: Blob[] = [];
    const revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL(blob: Blob) {
          objects.push(blob);
          return "blob:workspace-snapshot";
        }
        static revokeObjectURL = revoke;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    queue.data = {
      items: [investigation("a", "awaiting_approval", "Routing boundary")],
      total: 51,
      limit: 100,
      offset: 0,
    };
    audit.data = { items: [], cursor: 0, has_more: true };
    setup(dashboard);
    fireEvent.click(screen.getByRole("button", { name: "30 days" }));
    fireEvent.click(screen.getByRole("button", { name: "Export snapshot" }));
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:workspace-snapshot");
    const serialized = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(objects[0]);
    });
    const snapshot = JSON.parse(serialized);
    expect(snapshot.dashboard).toEqual(dashboard);
    expect(snapshot.investigations.items[0].id).toBe("a");
    expect(snapshot.investigations.total).toBe(51);
    expect(snapshot.audit.has_more).toBe(true);
    expect(snapshot.audit.scope).toContain("First loaded audit page");
    expect(snapshot.chart.window_days).toBe(30);
    expect(snapshot.chart.daily_counts).toHaveLength(30);
    expect(snapshot.chart.timezone).toBe("UTC");
    expect(snapshot).not.toHaveProperty("csrf");
    expect(screen.getByText(/Workspace snapshot exported/)).toBeVisible();
  });
  it("rearranges panels with keyboard controls and persists only this account's layout metadata", () => {
    setup(dashboard, true, true, "lab:member-a");
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Customize layout" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Move Investigation queue up" }),
    );
    const panels = [
      ...document.querySelectorAll<HTMLElement>("[data-dashboard-widget]"),
    ].map((element) => element.dataset.dashboardWidget);
    expect(panels.slice(0, 2)).toEqual(["queue", "activity"]);
    const saved = JSON.parse(
      localStorage.getItem(dashboardLayoutKey("lab:member-a")!)!,
    );
    expect(Object.keys(saved).sort()).toEqual(["order", "version", "wide"]);
    expect(saved.order).toEqual(panels);
    expect(
      screen.getByText(/Saved on this browser for your account/),
    ).toBeVisible();
  });
  it("allows arrow-key moves from the dedicated handle and restores account-specific order on return", () => {
    setup(dashboard, true, true, "lab:member-a");
    fireEvent.click(screen.getByRole("button", { name: "Customize layout" }));
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Drag Investigation queue" }),
      { key: "ArrowUp" },
    );
    expect(
      document.querySelector<HTMLElement>("[data-dashboard-widget]")?.dataset
        .dashboardWidget,
    ).toBe("queue");
    cleanup();
    setup(dashboard, true, true, "lab:member-b");
    expect(
      document.querySelector<HTMLElement>("[data-dashboard-widget]")?.dataset
        .dashboardWidget,
    ).toBe("activity");
    cleanup();
    setup(dashboard, true, true, "lab:member-a");
    expect(
      document.querySelector<HTMLElement>("[data-dashboard-widget]")?.dataset
        .dashboardWidget,
    ).toBe("queue");
  });
  it("expands a panel, restores its width, and resets just this account's layout", () => {
    localStorage.setItem("another-preference", "retained");
    setup(dashboard, true, true, "lab:member-a");
    fireEvent.click(screen.getByRole("button", { name: "Customize layout" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Workspace status" }),
    );
    expect(
      document.querySelector('[data-dashboard-widget="health"]'),
    ).toHaveAttribute("data-layout-size", "wide");
    expect(
      JSON.parse(localStorage.getItem(dashboardLayoutKey("lab:member-a")!)!)
        .wide,
    ).toContain("health");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Use standard width for Workspace status",
      }),
    );
    expect(
      document.querySelector('[data-dashboard-widget="health"]'),
    ).toHaveAttribute("data-layout-size", "standard");
    fireEvent.click(
      screen.getByRole("button", { name: "Move Investigation queue up" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(
      [
        ...document.querySelectorAll<HTMLElement>("[data-dashboard-widget]"),
      ].map((element) => element.dataset.dashboardWidget),
    ).toEqual(defaultDashboardLayout().order);
    expect(
      localStorage.getItem(dashboardLayoutKey("lab:member-a")!),
    ).toBeNull();
    expect(localStorage.getItem("another-preference")).toBe("retained");
  });
  it("keeps panels usable when persistence is blocked", () => {
    setup(dashboard, false, false, "lab:member-a");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage blocked");
    });
    fireEvent.click(screen.getByRole("button", { name: "Customize layout" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Move Investigation queue up" }),
    );
    expect(
      document.querySelector<HTMLElement>("[data-dashboard-widget]")?.dataset
        .dashboardWidget,
    ).toBe("queue");
    expect(
      screen.getByText(
        /Updated for this visit; browser storage is unavailable/,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Start fresh investigator" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Submit first report" }),
    ).not.toBeInTheDocument();
  });
  it("limits pointer rearranging to explicit handles and commits a clearly indicated after-target drop", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    setup(dashboard, true, true, "lab:member-a");
    expect(
      screen.queryByRole("button", { name: "Drag Audit activity" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Customize layout" }));
    const target = document.querySelector<HTMLElement>(
      '[data-dashboard-widget="composition"]',
    )!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 100,
      bottom: 200,
      left: 0,
      right: 500,
      width: 500,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", { name: "Drag Audit activity" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 190 });
    expect(screen.getByText("Drop after Case composition")).toBeVisible();
    fireEvent.pointerUp(handle, { clientX: 20, clientY: 190 });
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-dashboard-widget]")]
        .map((element) => element.dataset.dashboardWidget)
        .slice(0, 3),
    ).toEqual(["queue", "composition", "activity"]);
    expect(
      screen.queryByText("Drop after Case composition"),
    ).not.toBeInTheDocument();
  });
  it("switches saved layouts when the authenticated account changes without leaking the previous account's preferences", () => {
    const first = {
      ...defaultDashboardLayout(),
      order: [
        "queue",
        "activity",
        "composition",
        "health",
        "budgets",
        "agents",
        "handoff",
      ],
    };
    localStorage.setItem(
      dashboardLayoutKey("lab:member-a")!,
      JSON.stringify(first),
    );
    const props = {
      dashboard,
      revision: 0,
      openCase: vi.fn(),
      discover: vi.fn(),
      busy: false,
      canWrite: true,
      canDiscover: true,
      newReport: vi.fn(),
      openMemory: vi.fn(),
      openInvestigations: vi.fn(),
    };
    const view = render(<Overview {...props} layoutOwner="lab:member-a" />);
    expect(
      document.querySelector<HTMLElement>("[data-dashboard-widget]")?.dataset
        .dashboardWidget,
    ).toBe("queue");
    view.rerender(<Overview {...props} layoutOwner="lab:member-b" />);
    expect(
      document.querySelector<HTMLElement>("[data-dashboard-widget]")?.dataset
        .dashboardWidget,
    ).toBe("activity");
    fireEvent.click(screen.getByRole("button", { name: "Customize layout" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Workspace status" }),
    );
    expect(
      JSON.parse(localStorage.getItem(dashboardLayoutKey("lab:member-b")!)!)
        .wide,
    ).toContain("health");
    expect(
      JSON.parse(localStorage.getItem(dashboardLayoutKey("lab:member-a")!)!)
        .wide,
    ).not.toContain("health");
  });
  it("cancels pointer rearranging without writing preferences or changing panel order", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    setup(dashboard, true, true, "lab:member-a");
    fireEvent.click(screen.getByRole("button", { name: "Customize layout" }));
    const target = document.querySelector<HTMLElement>(
      '[data-dashboard-widget="composition"]',
    )!;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => target),
    });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 100,
      bottom: 200,
      left: 0,
      right: 500,
      width: 500,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    const handle = screen.getByRole("button", { name: "Drag Audit activity" });
    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 110 });
    expect(screen.getByText("Drop before Case composition")).toBeVisible();
    fireEvent.pointerCancel(handle, { clientX: 20, clientY: 110 });
    expect(
      screen.queryByText("Drop before Case composition"),
    ).not.toBeInTheDocument();
    expect(
      [
        ...document.querySelectorAll<HTMLElement>("[data-dashboard-widget]"),
      ].map((element) => element.dataset.dashboardWidget),
    ).toEqual(defaultDashboardLayout().order);
    expect(
      localStorage.getItem(dashboardLayoutKey("lab:member-a")!),
    ).toBeNull();
  });
});
