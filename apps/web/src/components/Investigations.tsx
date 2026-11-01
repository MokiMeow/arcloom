import {
  Search,
  ArrowUpRight,
  ArrowUpDown,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useRemote } from "../api";
import type { CasePage, CaseState } from "../types";
import {
  Empty,
  ErrorNotice,
  Loading,
  SectionHead,
  StateBadge,
  formatDate,
  labels,
} from "./ui";

type SortKey = "title" | "updated_at" | "researcher" | "state";
const quickStates: { value: "" | CaseState; label: string }[] = [
  { value: "", label: "All states" },
  { value: "awaiting_approval", label: "Awaiting approval" },
  { value: "awaiting_review", label: "Awaiting review" },
  { value: "confirmed", label: "Confirmed" },
];

export function Investigations({
  revision,
  openCase,
  newReport,
  canWrite,
}: {
  revision: number;
  openCase: (id: string) => void;
  newReport: () => void;
  canWrite: boolean;
}) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({
    key: "updated_at",
    descending: true,
  });
  const [refreshing, setRefreshing] = useState(false);
  const scopeId = useId();
  const params = new URLSearchParams({
    q: search,
    limit: "20",
    offset: String(offset),
  });
  if (state) params.set("state", state);
  const { data, error, loading, refresh } = useRemote<CasePage>(
    "/api/investigations?" + params,
    revision,
    2500,
  );
  const filtered = Boolean(search || state);
  const rows = useMemo(
    () =>
      [...(data?.items ?? [])].sort((a, b) => {
        const comparison =
          sort.key === "updated_at"
            ? a.updated_at - b.updated_at
            : sort.key === "state"
              ? labels[a.state].localeCompare(labels[b.state])
              : a[sort.key].localeCompare(b[sort.key]);
        return (
          (sort.descending ? -comparison : comparison) ||
          a.id.localeCompare(b.id)
        );
      }),
    [data, sort],
  );
  const pageCounts = useMemo(() => {
    const counts: Partial<Record<CaseState, number>> = {};
    for (const item of data?.items ?? [])
      counts[item.state] = (counts[item.state] ?? 0) + 1;
    return counts;
  }, [data]);
  function filterState(value: string) {
    setState(value);
    setOffset(0);
  }
  function clearFilters() {
    setSearch("");
    setState("");
    setOffset(0);
  }
  function sortBy(key: SortKey) {
    setSort((previous) => ({
      key,
      descending:
        previous.key === key ? !previous.descending : key === "updated_at",
    }));
  }
  async function refreshList() {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }
  function columnSort(key: SortKey): "none" | "ascending" | "descending" {
    return sort.key !== key
      ? "none"
      : sort.descending
        ? "descending"
        : "ascending";
  }
  return (
    <>
      <SectionHead
        tag="Workspace / Investigations"
        title="Investigations"
        action={
          canWrite && (
            <button className="button primary" onClick={newReport}>
              <Plus size={16} />
              Submit report
            </button>
          )
        }
      >
        Follow every report, approval and outcome. Keep the evidence connected.
      </SectionHead>
      <section
        className="panel investigation-inbox"
        aria-label="Investigation inbox"
      >
        <header className="panel-head investigation-card-header">
          <div>
            <h2>Investigation inbox</h2>
            <p>Reports, hypotheses and reviewed outcomes.</p>
          </div>
          <button
            className="button small-button"
            aria-label="Refresh investigations"
            disabled={loading || refreshing}
            onClick={() => void refreshList()}
          >
            <RefreshCw size={15} className={refreshing ? "spin" : undefined} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </header>
        <div className="investigation-controls">
          <div
            className="investigation-tabs"
            role="group"
            aria-label="Filter investigation status"
            aria-describedby={scopeId}
          >
            {quickStates.map((item) => (
              <button
                key={item.value}
                type="button"
                className={state === item.value ? "active" : ""}
                aria-pressed={state === item.value}
                onClick={() => filterState(item.value)}
              >
                {item.value && (
                  <span
                    className={`status-dot status-dot-${item.value}`}
                    aria-hidden="true"
                  />
                )}
                {item.label}
                {data && (
                  <span
                    className="filter-count"
                    aria-label={`${item.value ? (pageCounts[item.value] ?? 0) : data.items.length} on this page`}
                  >
                    {item.value
                      ? (pageCounts[item.value] ?? 0)
                      : data.items.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="filters investigation-filters">
            <div className="search">
              <Search size={16} aria-hidden="true" />
              <input
                aria-label="Search investigations"
                placeholder="Search title, case ID, asset or test…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOffset(0);
                }}
              />
              {search && (
                <button
                  type="button"
                  className="icon-button search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("");
                    setOffset(0);
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            <select
              aria-label="Filter by status"
              value={state}
              onChange={(event) => filterState(event.target.value)}
            >
              <option value="">Every state</option>
              {Object.entries(labels).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
            {filtered && (
              <button className="text-button" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        </div>
        <div className="investigation-results-meta">
          <span aria-live="polite" aria-atomic="true">
            {data
              ? `${data.total} ${data.total === 1 ? "investigation" : "investigations"}${filtered ? " match your filters" : " in this workspace"}`
              : loading
                ? "Loading investigations…"
                : "Investigation list unavailable"}
            {refreshing ? " · Refreshing…" : ""}
          </span>
          <span id={scopeId}>
            Chip counts and sorting describe the loaded page.
          </span>
        </div>
        <ErrorNotice message={error} />
        {loading && !data ? (
          <Loading />
        ) : rows.length ? (
          <>
            <div
              className="investigations-desktop table-scroll"
              role="region"
              aria-label="Investigation records"
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">
                  Investigation records. Column sorting applies to the loaded
                  page.
                </caption>
                <thead>
                  <tr>
                    <th aria-sort={columnSort("title")}>
                      <button
                        className="table-sort"
                        onClick={() => sortBy("title")}
                        aria-label="Sort loaded investigations by title"
                      >
                        Investigation
                        <ArrowUpDown size={13} aria-hidden="true" />
                      </button>
                    </th>
                    <th>Origin / revision</th>
                    <th aria-sort={columnSort("researcher")}>
                      <button
                        className="table-sort"
                        onClick={() => sortBy("researcher")}
                        aria-label="Sort loaded investigations by researcher"
                      >
                        Researcher
                        <ArrowUpDown size={13} aria-hidden="true" />
                      </button>
                    </th>
                    <th aria-sort={columnSort("state")}>
                      <button
                        className="table-sort"
                        onClick={() => sortBy("state")}
                        aria-label="Sort loaded investigations by status"
                      >
                        Status
                        <ArrowUpDown size={13} aria-hidden="true" />
                      </button>
                    </th>
                    <th aria-sort={columnSort("updated_at")}>
                      <button
                        className="table-sort"
                        onClick={() => sortBy("updated_at")}
                        aria-label="Sort loaded investigations by updated time"
                      >
                        Updated
                        <ArrowUpDown size={13} aria-hidden="true" />
                      </button>
                    </th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <button
                          className="row-title"
                          onClick={() => openCase(item.id)}
                        >
                          {item.title}
                        </button>
                        <small className="block muted">
                          {item.asset_id} · {item.test_id}
                        </small>
                        <code className="investigation-id">{item.id}</code>
                      </td>
                      <td>
                        {item.origin}
                        <small className="block muted">{item.revision}</small>
                      </td>
                      <td>{item.researcher}</td>
                      <td>
                        <StateBadge state={item.state} stale={item.stale} />
                      </td>
                      <td className="nowrap muted">
                        <time
                          dateTime={new Date(
                            item.updated_at * 1000,
                          ).toISOString()}
                        >
                          {formatDate(item.updated_at)}
                        </time>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Open ${item.title}`}
                          onClick={() => openCase(item.id)}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="investigations-mobile"
              aria-label="Investigation cards"
            >
              <label className="mobile-investigation-sort">
                Sort this page
                <select
                  aria-label="Sort loaded investigations"
                  value={`${sort.key}:${sort.descending ? "desc" : "asc"}`}
                  onChange={(event) => {
                    const [key, direction] = event.target.value.split(":");
                    setSort({
                      key: key as SortKey,
                      descending: direction === "desc",
                    });
                  }}
                >
                  <option value="updated_at:desc">Recently updated</option>
                  <option value="updated_at:asc">Oldest updated</option>
                  <option value="title:asc">Title A–Z</option>
                  <option value="title:desc">Title Z–A</option>
                  <option value="researcher:asc">Researcher A–Z</option>
                  <option value="researcher:desc">Researcher Z–A</option>
                  <option value="state:asc">Status A–Z</option>
                  <option value="state:desc">Status Z–A</option>
                </select>
              </label>
              {rows.map((item) => (
                <article className="investigation-card" key={item.id}>
                  <div className="investigation-card-status">
                    <StateBadge state={item.state} stale={item.stale} />
                    <span className="revision-pill">{item.revision}</span>
                  </div>
                  <h2 className="investigation-card-title">
                    <button
                      className="row-title"
                      onClick={() => openCase(item.id)}
                    >
                      {item.title}
                      <ArrowUpRight size={17} aria-hidden="true" />
                    </button>
                  </h2>
                  <code className="investigation-id">{item.id}</code>
                  <dl className="investigation-card-details">
                    <div>
                      <dt>Asset</dt>
                      <dd>{item.asset_id}</dd>
                    </div>
                    <div>
                      <dt>Test</dt>
                      <dd>{item.test_id}</dd>
                    </div>
                    <div>
                      <dt>Researcher</dt>
                      <dd>{item.researcher}</dd>
                    </div>
                    <div>
                      <dt>Origin</dt>
                      <dd>{item.origin}</dd>
                    </div>
                  </dl>
                  <footer className="investigation-card-footer">
                    <span>Last updated</span>
                    <time
                      dateTime={new Date(item.updated_at * 1000).toISOString()}
                    >
                      {formatDate(item.updated_at)}
                    </time>
                  </footer>
                </article>
              ))}
            </div>
          </>
        ) : error && !data ? (
          <div className="empty-states investigations-unavailable">
            <Empty title="Investigations could not be loaded">
              Check the error above, then retry. Your investigation records have
              not been changed.
            </Empty>
            <button
              className="button"
              disabled={refreshing}
              onClick={() => void refreshList()}
            >
              {refreshing ? "Retrying…" : "Retry investigations"}
            </button>
          </div>
        ) : (
          <div className="empty-states investigations-empty">
            <Empty
              title={
                filtered
                  ? "No matching investigations"
                  : "No investigations yet"
              }
            >
              {filtered
                ? "Try another title, case ID, asset, test or status. Clear the filters to return to your inbox."
                : canWrite
                  ? "Submit a report from the registered lab to begin your first evidence trail."
                  : "A researcher can submit the first report. Its decisions and evidence will appear here."}
            </Empty>
            {filtered && (
              <button className="button" onClick={clearFilters}>
                Show all investigations
              </button>
            )}
          </div>
        )}
        {data && (data.total > 20 || offset > 0) && (
          <div className="pagination">
            <button
              className="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 20))}
            >
              Previous
            </button>
            <span>
              {data.items.length ? offset + 1 : 0}–
              {Math.min(data.total, offset + data.items.length)} of {data.total}
            </span>
            <button
              className="button"
              disabled={offset + 20 >= data.total}
              onClick={() => setOffset(offset + 20)}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </>
  );
}
