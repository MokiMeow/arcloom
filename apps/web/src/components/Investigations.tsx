import { Search, ArrowUpRight, Plus } from "lucide-react";
import { useState } from "react";
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
  const params = new URLSearchParams({
    q: search,
    limit: "20",
    offset: String(offset),
  });
  if (state) params.set("state", state);
  const { data, error, loading } = useRemote<CasePage>(
    "/api/investigations?" + params,
    revision,
    2500,
  );
  return (
    <>
      <SectionHead
        tag="Investigation inbox"
        title="One case. Every decision."
        action={
          canWrite && (
            <button className="button primary" onClick={newReport}>
              <Plus size={16} />
              Submit report
            </button>
          )
        }
      >
        Reported issues, agent hypotheses, and negative results stay distinct
        and attributable.
      </SectionHead>
      <div className="filters">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Search investigations"
            placeholder="Search titles, assets or test IDs"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <select
          aria-label="Filter by status"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">Every state</option>
          {Object.entries(labels).map(([key, value]) => (
            <option key={key} value={key}>
              {value}
            </option>
          ))}
        </select>
        <span className="muted">{data?.total ?? 0} investigations</span>
      </div>
      <ErrorNotice message={error} />
      <div className="panel">
        {loading && !data ? (
          <Loading />
        ) : data?.items.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Investigation</th>
                  <th>Origin / revision</th>
                  <th>Researcher</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <button
                        className="row-title"
                        onClick={() => openCase(c.id)}
                      >
                        {c.title}
                      </button>
                      <small className="block muted">
                        {c.asset_id} · {c.test_id}
                      </small>
                    </td>
                    <td>
                      {c.origin}
                      <small className="block muted">{c.revision}</small>
                    </td>
                    <td>{c.researcher}</td>
                    <td>
                      <StateBadge
                        state={c.state as CaseState}
                        stale={c.stale}
                      />
                    </td>
                    <td className="nowrap muted">{formatDate(c.updated_at)}</td>
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Open ${c.title}`}
                        onClick={() => openCase(c.id)}
                      >
                        <ArrowUpRight size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching investigations">
            {canWrite
              ? "Create a report or clear your filters."
              : "Clear your filters or ask a researcher to submit a report."}
          </Empty>
        )}
      </div>
      {data && data.total > 20 && (
        <div className="pagination">
          <button
            className="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            Previous
          </button>
          <span>
            {offset + 1}–{Math.min(data.total, offset + 20)} of {data.total}
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
    </>
  );
}
