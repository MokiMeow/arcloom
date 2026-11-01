export const DASHBOARD_WIDGETS = [
  "activity",
  "queue",
  "composition",
  "health",
  "budgets",
  "agents",
  "handoff",
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number];
export interface DashboardLayout {
  version: 1;
  order: DashboardWidgetId[];
  wide: DashboardWidgetId[];
}
export const DASHBOARD_WIDGET_TITLES: Record<DashboardWidgetId, string> = {
  activity: "Audit activity",
  queue: "Investigation queue",
  composition: "Case composition",
  health: "Workspace status",
  budgets: "Revision budgets",
  agents: "Agent contexts",
  handoff: "Memory handoff",
};
const isWidget = (value: unknown): value is DashboardWidgetId =>
  typeof value === "string" &&
  DASHBOARD_WIDGETS.includes(value as DashboardWidgetId);
export function defaultDashboardLayout(): DashboardLayout {
  return {
    version: 1,
    order: [...DASHBOARD_WIDGETS],
    wide: ["activity", "queue", "handoff"],
  };
}
export function dashboardLayoutKey(owner: string | undefined): string | null {
  return owner
    ? `arcloom:dashboard-layout:v1:${encodeURIComponent(owner)}`
    : null;
}
export function parseDashboardLayout(
  serialized: string | null,
): DashboardLayout {
  if (!serialized || serialized.length > 10_000)
    return defaultDashboardLayout();
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object") return defaultDashboardLayout();
    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1 || !Array.isArray(candidate.order))
      return defaultDashboardLayout();
    const order = [...new Set(candidate.order.filter(isWidget))];
    for (const id of DASHBOARD_WIDGETS) if (!order.includes(id)) order.push(id);
    return {
      version: 1,
      order,
      wide: Array.isArray(candidate.wide)
        ? [...new Set(candidate.wide.filter(isWidget))]
        : defaultDashboardLayout().wide,
    };
  } catch {
    return defaultDashboardLayout();
  }
}
export function moveDashboardWidget(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  offset: -1 | 1,
): DashboardLayout {
  const from = layout.order.indexOf(id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[from], order[to]] = [order[to], order[from]];
  return { ...layout, order };
}
export function placeDashboardWidget(
  layout: DashboardLayout,
  id: DashboardWidgetId,
  target: DashboardWidgetId,
  after: boolean,
): DashboardLayout {
  if (
    id === target ||
    !layout.order.includes(id) ||
    !layout.order.includes(target)
  )
    return layout;
  const order = layout.order.filter((item) => item !== id);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, id);
  return { ...layout, order };
}
export function toggleDashboardWidgetWidth(
  layout: DashboardLayout,
  id: DashboardWidgetId,
): DashboardLayout {
  return {
    ...layout,
    wide: layout.wide.includes(id)
      ? layout.wide.filter((item) => item !== id)
      : [...layout.wide, id],
  };
}
