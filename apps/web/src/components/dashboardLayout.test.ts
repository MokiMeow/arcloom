import { describe, expect, it } from "vitest";
import {
  dashboardLayoutKey,
  defaultDashboardLayout,
  moveDashboardWidget,
  parseDashboardLayout,
  placeDashboardWidget,
  toggleDashboardWidgetWidth,
} from "./dashboardLayout";

describe("dashboard layout preferences", () => {
  it("keeps every supported panel when stored preferences contain duplicates, unknown panels, and omitted panels", () => {
    const restored = parseDashboardLayout(
      JSON.stringify({
        version: 1,
        order: ["queue", "queue", "untrusted", "activity"],
        wide: ["queue", "untrusted", "queue"],
      }),
    );
    expect(restored.order).toEqual([
      "queue",
      "activity",
      "composition",
      "health",
      "budgets",
      "agents",
      "handoff",
    ]);
    expect(restored.wide).toEqual(["queue"]);
  });
  it.each([null, "{bad", "[]", '{"version":2,"order":[]}', "x".repeat(10_001)])(
    "recovers safely from invalid or unsupported storage",
    (value) => {
      expect(parseDashboardLayout(value)).toEqual(defaultDashboardLayout());
    },
  );
  it("moves before and after a target without dropping or duplicating a panel", () => {
    const layout = defaultDashboardLayout();
    const before = placeDashboardWidget(layout, "handoff", "queue", false);
    expect(before.order).toEqual([
      "activity",
      "handoff",
      "queue",
      "composition",
      "health",
      "budgets",
      "agents",
    ]);
    const after = placeDashboardWidget(before, "activity", "agents", true);
    expect(after.order).toEqual([
      "handoff",
      "queue",
      "composition",
      "health",
      "budgets",
      "agents",
      "activity",
    ]);
    expect(layout.order[0]).toBe("activity");
  });
  it("keeps keyboard moves bounded at either end", () => {
    const layout = defaultDashboardLayout();
    expect(moveDashboardWidget(layout, "activity", -1)).toBe(layout);
    expect(moveDashboardWidget(layout, "handoff", 1)).toBe(layout);
    expect(moveDashboardWidget(layout, "queue", -1).order.slice(0, 2)).toEqual([
      "queue",
      "activity",
    ]);
  });
  it("toggles one panel width while preserving order", () => {
    const layout = defaultDashboardLayout();
    const wide = toggleDashboardWidgetWidth(layout, "health");
    expect(wide.order).toEqual(layout.order);
    expect(wide.wide).toContain("health");
    expect(toggleDashboardWidgetWidth(wide, "health")).toEqual(layout);
  });
  it("uses distinct account namespaces and has no anonymous persistence key", () => {
    expect(dashboardLayoutKey(undefined)).toBeNull();
    expect(dashboardLayoutKey("tenant-a:user-1")).not.toBe(
      dashboardLayoutKey("tenant-a:user-2"),
    );
    expect(dashboardLayoutKey("tenant-a:user-1")).not.toBe(
      dashboardLayoutKey("tenant-b:user-1"),
    );
  });
});
