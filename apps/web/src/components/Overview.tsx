import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Columns2,
  Expand,
  RotateCcw,
  LayoutGrid,
  ArrowUpRight,
  CheckCheck,
  ChevronDown,
  Database,
  Download,
  ChartNoAxesColumn,
  SlidersHorizontal,
  FilePlus2,
  Fingerprint,
  GitBranch,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Agent, Case, CasePage, Dashboard, Events } from "../types";
import { useRemote } from "../api";
import { HandoffBrief } from "./HandoffBrief";
import {
  Empty,
  ErrorNotice,
  Loading,
  SectionHead,
  StateBadge,
  formatDate,
} from "./ui";
import {
  DASHBOARD_WIDGET_TITLES,
  DASHBOARD_WIDGETS,
  dashboardLayoutKey,
  defaultDashboardLayout,
  moveDashboardWidget,
  parseDashboardLayout,
  placeDashboardWidget,
  toggleDashboardWidgetWidth,
  type DashboardLayout,
  type DashboardWidgetId,
} from "./dashboardLayout";
import "./overview.css";

type QueueFilter = "all" | "approval" | "review" | "active";
const matchesFilter = (item: Case, filter: QueueFilter) =>
  filter === "all" ||
  (filter === "approval" && item.state === "awaiting_approval") ||
  (filter === "review" && item.state === "awaiting_review") ||
  (filter === "active" && ["queued", "running"].includes(item.state));

function utcDayLabel(timestamp: number, long = false) {
  return new Intl.DateTimeFormat("en", {
    timeZone: "UTC",
    month: long ? "long" : "short",
    day: "numeric",
    ...(long ? { year: "numeric" as const } : {}),
  }).format(timestamp * 1000);
}

function loadLayoutPreference(owner: string | undefined): DashboardLayout {
  const key = dashboardLayoutKey(owner);
  if (!key) return defaultDashboardLayout();
  try {
    return parseDashboardLayout(window.localStorage.getItem(key));
  } catch {
    return defaultDashboardLayout();
  }
}

export function Overview({
  dashboard: d,
  revision,
  openCase,
  discover,
  busy,
  canWrite,
  canDiscover,
  newReport,
  openMemory,
  openInvestigations,
  browserToolsAvailable = false,
  layoutOwner,
}: {
  dashboard: Dashboard;
  revision: number;
  openCase: (id: string) => void;
  discover: () => void;
  busy: boolean;
  canWrite: boolean;
  canDiscover: boolean;
  newReport: () => void;
  openMemory: () => void;
  openInvestigations: () => void;
  browserToolsAvailable?: boolean;
  layoutOwner?: string;
}) {
  const [layout, setLayout] = useState(() => loadLayoutPreference(layoutOwner));
  const layoutRef = useRef(layout);
  const [customizing, setCustomizing] = useState(false);
  const [layoutMessage, setLayoutMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DashboardWidgetId | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: DashboardWidgetId;
    after: boolean;
  } | null>(null);
  const pointer = useRef<{
    id: DashboardWidgetId;
    pointerId: number;
    x: number;
    y: number;
    latestX: number;
    latestY: number;
    started: boolean;
    target: { id: DashboardWidgetId; after: boolean } | null;
  } | null>(null);
  useEffect(() => {
    const restored = loadLayoutPreference(layoutOwner);
    layoutRef.current = restored;
    setLayout(restored);
    setCustomizing(false);
    setLayoutMessage(null);
    pointer.current = null;
    setDragging(null);
    setDropTarget(null);
  }, [layoutOwner]);
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;
    const scrollAtEdge = () => {
      const active = pointer.current;
      if (!active?.started) return;
      const edge = 72;
      const delta =
        active.latestY < edge
          ? -Math.min(18, Math.max(4, (edge - active.latestY) / 4))
          : active.latestY > window.innerHeight - edge
            ? Math.min(
                18,
                Math.max(4, (active.latestY - window.innerHeight + edge) / 4),
              )
            : 0;
      if (delta) {
        window.scrollBy(0, delta);
        updateDragTarget(active.latestX, active.latestY);
      }
      frame = requestAnimationFrame(scrollAtEdge);
    };
    frame = requestAnimationFrame(scrollAtEdge);
    return () => cancelAnimationFrame(frame);
  }, [dragging]);
  function commitLayout(next: DashboardLayout, message: string) {
    layoutRef.current = next;
    setLayout(next);
    const key = dashboardLayoutKey(layoutOwner);
    if (!key) {
      setLayoutMessage(`${message} Changes last while this view is open.`);
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      setLayoutMessage(`${message} Saved on this browser for your account.`);
    } catch {
      setLayoutMessage(
        `${message} Updated for this visit; browser storage is unavailable.`,
      );
    }
  }
  function moveWidget(
    id: DashboardWidgetId,
    offset: -1 | 1,
    control = "handle",
  ) {
    const next = moveDashboardWidget(layoutRef.current, id, offset);
    if (next === layoutRef.current) return;
    commitLayout(
      next,
      `${DASHBOARD_WIDGET_TITLES[id]} moved ${offset < 0 ? "up" : "down"}.`,
    );
    requestAnimationFrame(() => {
      const frame = document.querySelector<HTMLElement>(
        `[data-dashboard-widget="${id}"]`,
      );
      const button = frame?.querySelector<HTMLButtonElement>(
        `[data-layout-control="${control}"]`,
      );
      (button && !button.disabled
        ? button
        : frame?.querySelector<HTMLButtonElement>(
            '[data-layout-control="handle"]',
          )
      )?.focus();
    });
  }
  function resetLayout() {
    pointer.current = null;
    setDragging(null);
    setDropTarget(null);
    const next = defaultDashboardLayout();
    layoutRef.current = next;
    setLayout(next);
    const key = dashboardLayoutKey(layoutOwner);
    try {
      if (key) window.localStorage.removeItem(key);
      setLayoutMessage("Default dashboard layout restored.");
    } catch {
      setLayoutMessage(
        "Default layout restored for this visit; browser storage is unavailable.",
      );
    }
  }
  function startDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    id: DashboardWidgetId,
  ) {
    if (!customizing || event.button > 0 || pointer.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    pointer.current = {
      id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      latestX: event.clientX,
      latestY: event.clientY,
      started: false,
      target: null,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function updateDragTarget(x: number, y: number) {
    const active = pointer.current;
    if (!active) return;
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("[data-dashboard-widget]");
    const id = element?.dataset.dashboardWidget as
      DashboardWidgetId | undefined;
    if (
      !element ||
      !id ||
      id === active.id ||
      !DASHBOARD_WIDGETS.includes(id)
    ) {
      active.target = null;
      setDropTarget(null);
      return;
    }
    const bounds = element.getBoundingClientRect();
    const target = { id, after: y > bounds.top + bounds.height / 2 };
    active.target = target;
    setDropTarget((previous) =>
      previous?.id === target.id && previous.after === target.after
        ? previous
        : target,
    );
  }
  function dragWidget(event: ReactPointerEvent<HTMLButtonElement>) {
    const active = pointer.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.latestX = event.clientX;
    active.latestY = event.clientY;
    if (
      !active.started &&
      Math.abs(event.clientX - active.x) + Math.abs(event.clientY - active.y) <
        8
    )
      return;
    if (!active.started) {
      active.started = true;
      setDragging(active.id);
    }
    updateDragTarget(event.clientX, event.clientY);
  }
  function finishDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    commit: boolean,
  ) {
    const active = pointer.current;
    if (!active || active.pointerId !== event.pointerId) return;
    pointer.current = null;
    setDragging(null);
    setDropTarget(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (commit && active.started && active.target) {
      commitLayout(
        placeDashboardWidget(
          layoutRef.current,
          active.id,
          active.target.id,
          active.target.after,
        ),
        `${DASHBOARD_WIDGET_TITLES[active.id]} moved ${active.target.after ? "after" : "before"} ${DASHBOARD_WIDGET_TITLES[active.target.id]}.`,
      );
    }
  }
  const cases = useRemote<CasePage>(
    "/api/investigations?limit=100",
    revision,
    2500,
  );
  const agents = useRemote<{ items: Agent[] }>(
    "/api/agents?limit=4",
    revision,
    5000,
  );
  const events = useRemote<Events>("/api/events?limit=200", revision, 5000);
  const [windowDays, setWindowDays] = useState(14);
  const [inspectedDay, setInspectedDay] = useState<number | null>(null);
  const [composition, setComposition] = useState<"states" | "assets">("states");
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [search, setSearch] = useState("");
  const approvalCount = d.counts.awaiting_approval ?? 0;
  const reviewCount = d.counts.awaiting_review ?? 0;
  const activeCount = (d.counts.queued ?? 0) + (d.counts.running ?? 0);
  const totalCases = Object.values(d.counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const decisions = approvalCount + reviewCount;
  const scopeExpired = d.scope_expires_at <= d.at;
  const scopeOpen = d.scope_enabled && !scopeExpired;
  const memoryReady = d.memory.available && d.memory.in_sync;
  const discoveryBlocked = !canDiscover
    ? "A reviewer or owner can start an investigator."
    : totalCases === 0
      ? "Submit the first report before starting a fresh investigator."
      : !memoryReady
        ? "Graph memory must be synchronized first."
        : scopeExpired
          ? "The assessment has expired. Ask the workspace owner to review assessment configuration."
          : !scopeOpen
            ? "Execution admission is paused."
            : busy
              ? "An investigator is already running."
              : undefined;
  const loadedCases = cases.data?.items ?? [];
  const filters: { id: QueueFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: loadedCases.length },
    {
      id: "approval",
      label: "Approval",
      count: loadedCases.filter((item) => matchesFilter(item, "approval"))
        .length,
    },
    {
      id: "review",
      label: "Evidence review",
      count: loadedCases.filter((item) => matchesFilter(item, "review")).length,
    },
    {
      id: "active",
      label: "Active",
      count: loadedCases.filter((item) => matchesFilter(item, "active")).length,
    },
  ];
  const query = search.trim().toLocaleLowerCase();
  const visibleCases = loadedCases.filter(
    (item) =>
      matchesFilter(item, filter) &&
      (!query ||
        [
          item.title,
          item.id,
          item.asset_id,
          item.test_id,
          item.researcher,
        ].some((value) => value.toLocaleLowerCase().includes(query))),
  );
  const distribution = [
    { id: "approval", label: "Awaiting approval", count: approvalCount },
    { id: "active", label: "Queued / running", count: activeCount },
    { id: "review", label: "Awaiting evidence review", count: reviewCount },
    {
      id: "confirmed",
      label: "Confirmed cases",
      count: d.counts.confirmed ?? 0,
    },
    {
      id: "recorded",
      label: "Other recorded outcomes",
      count:
        (d.counts.not_reproduced ?? 0) +
        (d.counts.inconclusive ?? 0) +
        (d.counts.rejected ?? 0) +
        (d.counts.denied ?? 0),
    },
  ];
  const loadedEvents = events.data?.items ?? [];
  const lastDay = Math.floor(d.at / 86400) * 86400;
  const dailyActivity = Array.from({ length: windowDays }, (_, index) => {
    const day = lastDay - (windowDays - index - 1) * 86400;
    return {
      day,
      count: loadedEvents.filter(
        (event) =>
          event.at >= day && event.at < day + 86400 && event.at <= d.at,
      ).length,
    };
  });
  const windowEventCount = dailyActivity.reduce(
    (sum, day) => sum + day.count,
    0,
  );
  const maximumDailyCount = Math.max(
    3,
    Math.ceil(Math.max(0, ...dailyActivity.map((day) => day.count)) / 3) * 3,
  );
  const activeDayIndex = Math.max(
    0,
    dailyActivity.findIndex((day) => day.day === (inspectedDay ?? lastDay)),
  );
  const activeDay = dailyActivity[activeDayIndex];
  const assets = [...new Set(loadedCases.map((item) => item.asset_id))]
    .map((asset) => ({
      id: asset,
      label: asset,
      count: loadedCases.filter((item) => item.asset_id === asset).length,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const compositionItems = composition === "states" ? distribution : assets;
  const compositionTotal =
    composition === "states" ? totalCases : loadedCases.length;
  function exportSnapshot() {
    try {
      const data = {
        schemaVersion: 1,
        exported_from_server_at: d.at,
        dashboard: d,
        investigations: {
          items: loadedCases,
          loaded: loadedCases.length,
          total: cases.data?.total ?? null,
          request: "/api/investigations?limit=100",
          error: cases.error,
        },
        audit: {
          items: loadedEvents,
          loaded: loadedEvents.length,
          has_more: events.data?.has_more ?? null,
          request: "/api/events?limit=200",
          scope:
            "First loaded audit page; not a complete-history export when has_more is true.",
          error: events.error,
        },
        chart: {
          window_days: windowDays,
          timezone: "UTC",
          daily_counts: dailyActivity,
        },
      };
      const objectUrl = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `arcloom-workspace-snapshot-${new Date(d.at * 1000).toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(objectUrl);
      setSnapshotMessage(
        "Workspace snapshot exported with loaded data and its source limits.",
      );
    } catch {
      setSnapshotMessage(
        "The snapshot could not be downloaded. Try exporting again.",
      );
    }
  }
  const widgetContent: Record<DashboardWidgetId, ReactNode> = {
    activity: (
      <section
        className="panel insights-activity-panel"
        aria-labelledby="insights-activity-title"
      >
        <header className="ops-panel-heading">
          <div className="insights-chart-heading">
            <span className="insights-heading-icon">
              <ChartNoAxesColumn size={16} />
            </span>
            <div>
              <h2 id="insights-activity-title">Loaded audit activity</h2>
              <p>
                Daily journal events · UTC · based on the first loaded audit
                page
              </p>
            </div>
          </div>
          <div
            className="insights-range-control"
            role="group"
            aria-label="Audit activity window"
          >
            {[7, 14, 30].map((days) => (
              <button
                type="button"
                key={days}
                aria-pressed={windowDays === days}
                onClick={() => {
                  setWindowDays(days);
                  setInspectedDay(null);
                }}
              >
                {days} days
              </button>
            ))}
          </div>
        </header>
        <ErrorNotice message={events.error} />
        {events.loading && !events.data ? (
          <Loading />
        ) : !events.data ? (
          <p className="ops-inline-message">
            Audit activity could not be loaded. The workspace counts and
            investigation queue remain available.
          </p>
        ) : (
          <>
            <div className="insights-chart-summary">
              <div>
                <strong>{windowEventCount}</strong>
                <span>loaded events in this {windowDays}-day window</span>
              </div>
              <span>
                {events.data.has_more
                  ? "More audit history exists outside this page"
                  : "The loaded audit page has no further events"}
              </span>
            </div>
            <div className="insights-chart-body">
              <svg
                className="insights-audit-chart"
                viewBox="0 0 960 240"
                preserveAspectRatio="none"
                role="img"
                aria-labelledby="insights-chart-title"
                aria-describedby="insights-chart-description"
              >
                <title id="insights-chart-title">
                  Loaded audit events by UTC day
                </title>
                <desc id="insights-chart-description">
                  {windowEventCount} loaded audit events between{" "}
                  {utcDayLabel(dailyActivity[0].day, true)} and{" "}
                  {utcDayLabel(lastDay, true)}. Use the day inspector or the
                  table below for exact daily counts.
                </desc>
                {[0, 1, 2, 3].map((tick) => (
                  <g key={tick}>
                    <line
                      x1="38"
                      x2="944"
                      y1={20 + tick * 62}
                      y2={20 + tick * 62}
                      stroke="#eceff2"
                      strokeDasharray="3 5"
                    />
                  </g>
                ))}
                {dailyActivity.map((item, index) => {
                  const slot = 896 / dailyActivity.length;
                  const height = (item.count / maximumDailyCount) * 186;
                  return (
                    <g key={item.day}>
                      <rect
                        x={43 + index * slot + slot * 0.2}
                        y={206 - height}
                        width={slot * 0.6}
                        height={height}
                        rx="2"
                        fill={
                          activeDay.day === item.day ? "#79b5da" : "#272a30"
                        }
                        onMouseEnter={() => setInspectedDay(item.day)}
                        onClick={() => setInspectedDay(item.day)}
                      >
                        <title>
                          {utcDayLabel(item.day, true)}: {item.count} loaded
                          events
                        </title>
                      </rect>
                    </g>
                  );
                })}
              </svg>
              <div className="insights-y-axis" aria-hidden="true">
                {[0, 1, 2, 3].map((tick) => (
                  <span key={tick}>
                    {Math.round(maximumDailyCount * (1 - tick / 3))}
                  </span>
                ))}
              </div>
              <div className="insights-date-axis" aria-hidden="true">
                <span>{utcDayLabel(dailyActivity[0].day)}</span>
                <span>
                  {utcDayLabel(
                    dailyActivity[Math.floor(dailyActivity.length / 2)].day,
                  )}
                </span>
                <span>{utcDayLabel(lastDay)}</span>
              </div>
              {windowEventCount === 0 && (
                <p className="insights-zero-activity">
                  No loaded audit events fall in this window.
                </p>
              )}
            </div>
            <div className="insights-day-inspector">
              <label htmlFor="insights-audit-day">Inspect a day</label>
              <input
                id="insights-audit-day"
                type="range"
                min="0"
                max={dailyActivity.length - 1}
                value={activeDayIndex}
                aria-valuetext={`${utcDayLabel(activeDay.day, true)}: ${activeDay.count} loaded events`}
                onChange={(event) =>
                  setInspectedDay(dailyActivity[Number(event.target.value)].day)
                }
              />
              <output htmlFor="insights-audit-day" aria-live="polite">
                {utcDayLabel(activeDay.day)} ·{" "}
                <strong>{activeDay.count}</strong> events
              </output>
            </div>
            <details className="insights-data-table">
              <summary>View daily event counts</summary>
              <table>
                <caption>First loaded audit page, grouped by UTC date</caption>
                <thead>
                  <tr>
                    <th scope="col">UTC date</th>
                    <th scope="col">Loaded events</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyActivity.map((item) => (
                    <tr key={item.day}>
                      <td>{utcDayLabel(item.day, true)}</td>
                      <td>{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            <footer className="insights-source-note">
              Source: {loadedEvents.length} events loaded from the first audit
              page.
              {events.data.has_more
                ? " Additional history is available in Activity & evidence; this chart does not cover the full journal."
                : " Counts cover only loaded events within the selected dates."}
            </footer>
          </>
        )}
      </section>
    ),
    queue: (
      <section className="panel ops-queue" aria-labelledby="ops-queue-heading">
        <header className="ops-panel-heading">
          <div>
            <h2 id="ops-queue-heading">Investigation queue</h2>
            <p>
              {decisions > 0
                ? `${approvalCount} awaiting approval · ${reviewCount} awaiting evidence review`
                : "Reports, proposals and recorded outcomes in one workbench."}
            </p>
          </div>
          <button className="text-button" onClick={openInvestigations}>
            View all <ArrowUpRight size={14} />
          </button>
        </header>
        {decisions > 0 ? (
          <div className="ops-next-action" aria-label="Next workspace action">
            <ShieldCheck size={17} />
            <span>
              {decisions}{" "}
              {decisions === 1 ? "decision needs" : "decisions need"} a human
              review.
            </span>
            <button className="text-button" onClick={openInvestigations}>
              Open decision queue <ArrowRight size={14} />
            </button>
          </div>
        ) : totalCases === 0 ? (
          <div className="ops-next-action" aria-label="Next workspace action">
            <FilePlus2 size={17} />
            <span>
              {canWrite
                ? "Start the evidence trail with a registered lab observation."
                : "Ask a researcher to submit the first lab observation."}
            </span>
            {canWrite && (
              <button
                className="button primary small-button"
                onClick={newReport}
              >
                Submit first report <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : (
          <div
            className="ops-next-action ops-next-neutral"
            aria-label="Next workspace action"
          >
            <CheckCheck size={17} />
            <span>No approval or evidence-review decisions waiting.</span>
            <button className="text-button" onClick={openMemory}>
              Inspect memory <ArrowRight size={14} />
            </button>
          </div>
        )}
        <div className="ops-queue-toolbar">
          <div
            className="ops-filter-group"
            role="group"
            aria-label="Filter loaded investigations"
          >
            {filters.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={filter === item.id}
                aria-label={`${item.label}: ${item.count} loaded investigations`}
                className={`ops-filter ${filter === item.id ? "ops-filter-selected" : ""}`}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span>{item.count}</span>
              </button>
            ))}
          </div>
          <label className="ops-queue-search">
            <Search size={15} />
            <input
              aria-label="Search loaded investigations"
              placeholder="Find in loaded cases…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        <ErrorNotice message={cases.error} />
        {cases.loading && !cases.data ? (
          <Loading />
        ) : !cases.data && cases.error ? (
          <p className="ops-inline-message">
            The queue could not be loaded. Existing workspace totals remain
            visible above.
          </p>
        ) : visibleCases.length ? (
          <div className="ops-queue-table-wrap">
            <table className="ops-queue-table">
              <thead>
                <tr>
                  <th scope="col">Investigation</th>
                  <th scope="col">Status</th>
                  <th scope="col">Researcher</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {visibleCases.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button
                        className="case-row ops-case-title"
                        onClick={() => openCase(item.id)}
                      >
                        <span>{item.title}</span>
                        <ArrowUpRight size={14} />
                      </button>
                      <span className="ops-case-meta">
                        {item.asset_id} <span>·</span> {item.test_id}{" "}
                        <span>·</span> <code>{item.revision}</code>
                      </span>
                    </td>
                    <td>
                      <StateBadge state={item.state} stale={item.stale} />
                    </td>
                    <td className="ops-case-researcher">{item.researcher}</td>
                    <td className="ops-case-updated">
                      {formatDate(item.updated_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ops-queue-empty">
            <Empty
              title={
                loadedCases.length
                  ? "No cases match these filters"
                  : "Your investigation queue starts here"
              }
            >
              {loadedCases.length
                ? "Try another state or search by title, asset, test ID or researcher."
                : "Submitted reports and agent proposals appear here. Approval and evidence review remain separate."}
            </Empty>
            {(filter !== "all" || search) && (
              <button
                className="button small-button"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        {cases.data && (
          <footer className="ops-queue-footer">
            <span>
              {visibleCases.length} shown · {loadedCases.length} loaded
              {cases.data.total !== undefined ? ` of ${cases.data.total}` : ""}
            </span>
            <span>Filters apply to loaded cases</span>
          </footer>
        )}
      </section>
    ),
    agents: (
      <section
        className="panel ops-agent-panel"
        aria-labelledby="ops-agent-heading"
      >
        <header className="ops-panel-heading">
          <div>
            <h2 id="ops-agent-heading">Independent agent contexts</h2>
            <p>
              {d.model.sessions} sessions recorded · no conversation carried
              between sessions
            </p>
          </div>
          <span className="badge">
            {d.model.decision_model
              ? "Cloudflare decision model"
              : d.model.live_llm
                ? d.model.provider
                : "Deterministic mode"}
          </span>
        </header>
        <ErrorNotice message={agents.error} />
        {agents.loading && !agents.data ? (
          <Loading />
        ) : agents.data?.items.length ? (
          <ol className="ops-agent-list">
            {agents.data.items.map((agent) => (
              <li key={agent.id}>
                <span className="ops-agent-icon">
                  <Sparkles size={15} />
                </span>
                <div>
                  <div className="ops-agent-top">
                    <strong>
                      Fresh context · {agent.status.replaceAll("_", " ")}
                    </strong>
                    <time
                      dateTime={new Date(agent.created_at * 1000).toISOString()}
                    >
                      {formatDate(agent.created_at)}
                    </time>
                  </div>
                  <p>{agent.reason}</p>
                  <span className="ops-agent-meta">
                    {agent.provider} · {agent.previous_messages} prior messages
                  </span>
                  {agent.case_id && (
                    <button
                      className="text-button"
                      onClick={() => openCase(agent.case_id!)}
                    >
                      Open hypothesis <ArrowUpRight size={13} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          !agents.error && (
            <Empty title="Ready for a fresh investigator">
              {d.verified_current > 0
                ? "Current graph support can guide the next proposal. A human still decides whether its test may run."
                : "Verify and review the first finding. A fresh agent then starts from graph-retrieved context."}
            </Empty>
          )
        )}
      </section>
    ),
    composition: (
      <section
        className="panel insights-composition-panel"
        aria-labelledby="insights-composition-heading"
      >
        <header className="ops-panel-heading">
          <div>
            <h2 id="insights-composition-heading">Case composition</h2>
            <p>
              {composition === "states"
                ? `${totalCases} cases across all workspace states`
                : `${loadedCases.length} loaded cases grouped by asset`}
            </p>
          </div>
        </header>
        <div
          className="insights-composition-controls"
          role="group"
          aria-label="Case composition grouping"
        >
          <button
            type="button"
            aria-pressed={composition === "states"}
            onClick={() => setComposition("states")}
          >
            Workflow states
          </button>
          <button
            type="button"
            aria-pressed={composition === "assets"}
            onClick={() => setComposition("assets")}
          >
            Loaded assets
          </button>
        </div>
        <div className="ops-distribution">
          {compositionItems.length ? (
            compositionItems.map((item) => (
              <div className="ops-distribution-row" key={item.id}>
                <div>
                  <span>{item.label}</span>
                  <strong>{item.count}</strong>
                </div>
                <div className="ops-bar-track" aria-hidden="true">
                  <span
                    className="ops-bar-fill"
                    style={{
                      width: compositionTotal
                        ? `${(item.count / compositionTotal) * 100}%`
                        : "0%",
                    }}
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="ops-inline-message">
              No loaded cases to group by asset.
            </p>
          )}
        </div>
        <p className="ops-distribution-note">
          {composition === "states"
            ? "Confirmed, negative and inconclusive outcomes remain distinct records."
            : "Asset counts apply to the loaded investigation page, not the complete workspace."}
        </p>
      </section>
    ),
    health: (
      <section className="panel ops-health-panel">
        <header className="ops-panel-heading">
          <h2>Workspace status</h2>
          <Database size={16} />
        </header>
        <dl className="ops-health-list">
          <div>
            <dt>Graph memory</dt>
            <dd>
              <span
                className={`ops-status-dot ${memoryReady ? "ops-dot-ready" : "ops-dot-warning"}`}
              />
              {memoryReady
                ? "Synchronized"
                : d.memory.available
                  ? "Projection pending"
                  : "Unavailable"}
            </dd>
          </div>
          <div>
            <dt>Pending events</dt>
            <dd>{d.memory.pending_events}</dd>
          </div>
          <div>
            <dt>Active revision</dt>
            <dd>
              <code>{d.revision}</code>
            </dd>
          </div>
          <div>
            <dt>Admission</dt>
            <dd>
              {scopeExpired
                ? "Assessment expired"
                : scopeOpen
                  ? "Open · approval required"
                  : "Paused"}
            </dd>
          </div>
          <div>
            <dt>Worker</dt>
            <dd>{d.worker.enabled ? "Enabled" : "Disabled"}</dd>
          </div>
        </dl>
        {d.worker.last_error && (
          <p className="ops-worker-error">
            Worker needs attention. Inspect Activity &amp; evidence for recorded
            outcomes.
          </p>
        )}
        <button className="ops-memory-button" onClick={openMemory}>
          Inspect graph memory <ArrowUpRight size={14} />
        </button>
      </section>
    ),
    budgets: (
      <section className="panel ops-quota-panel">
        <header className="ops-panel-heading">
          <h2>Revision budgets</h2>
          <span className="ops-quota-revision">{d.revision}</span>
        </header>
        <div className="ops-quota-body">
          <div className="ops-quota-label">
            <span>Lab executions</span>
            <strong>
              {d.budget.executions} <span>/ {d.budget.execution_limit}</span>
            </strong>
          </div>
          <progress
            aria-label="Lab executions used"
            value={d.budget.executions}
            max={d.budget.execution_limit}
          />
          <div className="ops-quota-label">
            <span>Model-call reservations</span>
            <strong>
              {d.budget.model_calls} <span>/ {d.budget.model_call_limit}</span>
            </strong>
          </div>
          <progress
            aria-label="Model-call reservations used"
            value={d.budget.model_calls}
            max={d.budget.model_call_limit}
          />
          <p>
            Failed and interrupted calls consume reserved budget. Limits apply
            to this deployment revision.
          </p>
        </div>
      </section>
    ),
    handoff: (
      <details className="ops-advanced-handoff" open>
        <summary>
          <span>
            <Database size={15} /> Verified memory handoff{" "}
            <small>Advanced / portable context</small>
          </span>
          <ChevronDown size={15} />
        </summary>
        <HandoffBrief
          key={d.revision}
          revision={revision}
          openCase={openCase}
          openMemory={openMemory}
          browserToolsAvailable={browserToolsAvailable}
        />
      </details>
    ),
  };
  return (
    <div className="ops-overview">
      <SectionHead
        tag="Workspace / Overview"
        title="Investigation overview"
        action={
          <div className="insights-header-actions">
            <button
              className="button"
              onClick={exportSnapshot}
              disabled={!cases.data || !events.data}
            >
              <Download size={15} /> Export snapshot
            </button>
            <button
              className="button primary"
              onClick={discover}
              disabled={Boolean(discoveryBlocked)}
              title={discoveryBlocked}
              aria-busy={busy}
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Start fresh investigator
            </button>
          </div>
        }
      >
        Review the next decision. Keep every conclusion connected to its
        evidence.
      </SectionHead>
      {snapshotMessage && (
        <p className="insights-export-status" role="status">
          {snapshotMessage}
        </p>
      )}
      <div className="ops-context-line">
        <span>
          <span
            className={`ops-status-dot ${memoryReady ? "ops-dot-ready" : "ops-dot-warning"}`}
          />{" "}
          {memoryReady ? "Memory synchronized" : "Memory needs attention"}
        </span>
        <span>
          Revision <code>{d.revision}</code>
        </span>
        <span>As of {formatDate(d.at)}</span>
      </div>
      <div className="stats-grid ops-kpis" aria-label="Workspace totals">
        <div className="stat">
          <span>
            <Fingerprint size={15} /> Current verified findings
          </span>
          <strong>{String(d.verified_current).padStart(2, "0")}</strong>
          <small>
            {d.verified_historical} findings retained across revisions
          </small>
        </div>
        <div className="stat">
          <span>
            <ShieldCheck size={15} /> Pending decisions
          </span>
          <strong>{String(decisions).padStart(2, "0")}</strong>
          <small>
            {approvalCount} approval · {reviewCount} evidence review
          </small>
        </div>
        <div className="stat">
          <span>
            <GitBranch size={15} /> Lab executions
          </span>
          <strong>
            {String(d.budget.executions).padStart(2, "0")}
            <em> / {d.budget.execution_limit}</em>
          </strong>
          <small>
            {d.counts.running ?? 0} running · {d.counts.queued ?? 0} queued
          </small>
        </div>
        <div className="stat">
          <span>
            <SlidersHorizontal size={15} /> Model-call reservations
          </span>
          <strong>
            {String(d.budget.model_calls).padStart(2, "0")}
            <em> / {d.budget.model_call_limit}</em>
          </strong>
          <small>{d.model.sessions} independent agent sessions</small>
        </div>
      </div>

      {!memoryReady && (
        <ErrorNotice
          message={`Graph memory ${d.memory.available ? "has pending writes" : "is unavailable"}. Discovery and test admission fail closed. Pending events: ${d.memory.pending_events}.`}
        />
      )}

      <div className="dashboard-layout-toolbar">
        <div>
          <strong>Your dashboard</strong>
          <span>
            {customizing
              ? "Drag a handle, use the move buttons, or change a panel’s width."
              : "Arrange the panels around the way you investigate."}
          </span>
        </div>
        <div className="dashboard-layout-actions">
          {customizing && (
            <button type="button" className="button" onClick={resetLayout}>
              <RotateCcw size={14} /> Reset layout
            </button>
          )}
          <button
            type="button"
            className="button"
            aria-pressed={customizing}
            onClick={() => {
              setCustomizing(!customizing);
              pointer.current = null;
              setDragging(null);
              setDropTarget(null);
            }}
          >
            <LayoutGrid size={14} />{" "}
            {customizing ? "Done arranging" : "Customize layout"}
          </button>
        </div>
      </div>
      <p className="dashboard-layout-feedback" aria-live="polite">
        {layoutMessage ??
          (layoutOwner
            ? "Layout preferences are private to this account on this browser."
            : "Layout changes last while this view is open.")}
      </p>
      <div
        className={`dashboard-widget-grid ${customizing ? "dashboard-customizing" : ""}`}
      >
        {layout.order.map((id, index) => (
          <section
            key={id}
            data-dashboard-widget={id}
            data-layout-size={layout.wide.includes(id) ? "wide" : "standard"}
            className={`dashboard-widget-frame ${layout.wide.includes(id) ? "dashboard-widget-wide" : ""} ${dragging === id ? "dashboard-widget-dragging" : ""} ${dropTarget?.id === id ? `dashboard-drop-${dropTarget.after ? "after" : "before"}` : ""}`}
            aria-label={`${DASHBOARD_WIDGET_TITLES[id]} dashboard panel`}
          >
            {customizing && (
              <div className="dashboard-widget-controls">
                <button
                  type="button"
                  className="dashboard-drag-handle"
                  data-layout-control="handle"
                  aria-label={`Drag ${DASHBOARD_WIDGET_TITLES[id]}`}
                  title="Drag to rearrange. Arrow Up and Arrow Down also move this panel."
                  onPointerDown={(event) => startDrag(event, id)}
                  onPointerMove={dragWidget}
                  onPointerUp={(event) => finishDrag(event, true)}
                  onPointerCancel={(event) => finishDrag(event, false)}
                  onLostPointerCapture={(event) => finishDrag(event, false)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault();
                      moveWidget(id, event.key === "ArrowUp" ? -1 : 1);
                    } else if (event.key === "Escape") {
                      pointer.current = null;
                      setDragging(null);
                      setDropTarget(null);
                      setLayoutMessage("Rearrangement canceled.");
                    }
                  }}
                >
                  <GripVertical size={16} />
                </button>
                <span>{DASHBOARD_WIDGET_TITLES[id]}</span>
                <div className="dashboard-widget-move-buttons">
                  <button
                    type="button"
                    data-layout-control="up"
                    aria-label={`Move ${DASHBOARD_WIDGET_TITLES[id]} up`}
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => moveWidget(id, -1, "up")}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    data-layout-control="down"
                    aria-label={`Move ${DASHBOARD_WIDGET_TITLES[id]} down`}
                    title="Move down"
                    disabled={index === layout.order.length - 1}
                    onClick={() => moveWidget(id, 1, "down")}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`${layout.wide.includes(id) ? "Use standard width for" : "Expand"} ${DASHBOARD_WIDGET_TITLES[id]}`}
                    title={
                      layout.wide.includes(id)
                        ? "Standard width on desktop"
                        : "Full width"
                    }
                    aria-pressed={layout.wide.includes(id)}
                    onClick={() => {
                      const next = toggleDashboardWidgetWidth(
                        layoutRef.current,
                        id,
                      );
                      commitLayout(
                        next,
                        `${DASHBOARD_WIDGET_TITLES[id]} uses ${next.wide.includes(id) ? "full" : "standard"} width on desktop.`,
                      );
                    }}
                  >
                    {layout.wide.includes(id) ? (
                      <Columns2 size={15} />
                    ) : (
                      <Expand size={15} />
                    )}
                  </button>
                </div>
              </div>
            )}
            {dropTarget?.id === id && (
              <div className="dashboard-drop-caption">
                Drop {dropTarget.after ? "after" : "before"}{" "}
                {DASHBOARD_WIDGET_TITLES[id]}
              </div>
            )}
            {widgetContent[id]}
          </section>
        ))}
      </div>
    </div>
  );
}
