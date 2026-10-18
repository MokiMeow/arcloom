import snapshots from "./snapshots.json";
import { ApiError } from "../api";
import { demoScenario } from "../demoMode";
import type { GraphNode } from "../types";

export async function demoRequest<T>(
  path: string,
  method: string,
  signal?: AbortSignal,
  scenario = demoScenario(),
): Promise<T> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (method !== "GET")
    throw new ApiError(
      "This public demo is read-only. Run the full application locally to approve or execute investigations.",
      403,
      "demo_read_only",
    );
  if (!path.startsWith("/api/"))
    throw new ApiError(
      "Not part of the demo snapshot.",
      404,
      "demo_not_recorded",
    );
  const url = new URL(path, "https://arcloom.demo");
  const snapshot = snapshots[scenario];
  const fixed = snapshot.fixed as Record<string, unknown>;
  const cases = snapshot.cases as Record<string, unknown>;
  const evidence = snapshot.evidence as Record<string, unknown>;
  let result: unknown;
  if (url.pathname === "/api/auth/session") {
    result = {
      actor: {
        id: "public-demo-viewer",
        tenant: snapshot.fixed["/api/dashboard"].workspace,
        role: "viewer",
      },
      csrf: null,
    };
  } else if (url.pathname === "/api/investigations") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const state = url.searchParams.get("state");
    const limit = Math.max(
      1,
      Math.min(100, Number(url.searchParams.get("limit")) || 20),
    );
    const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
    const items = snapshot.fixed["/api/investigations?limit=100"].items.filter(
      (item) =>
        (!state || item.state === state) &&
        (!q ||
          `${item.title} ${item.id} ${item.asset_id}`
            .toLowerCase()
            .includes(q)),
    );
    result = {
      items: items.slice(offset, offset + limit),
      total: items.length,
      offset,
      limit,
    };
  } else if (url.pathname.startsWith("/api/investigations/")) {
    const [, , , id, action] = url.pathname.split("/");
    result =
      action === "export"
        ? (snapshot.exports as Record<string, unknown>)[id]
        : cases[id];
  } else if (url.pathname.startsWith("/api/evidence/")) {
    result = evidence[url.pathname.slice("/api/evidence/".length)];
  } else if (url.pathname === "/api/events") {
    const events = snapshot.fixed["/api/events?limit=200"];
    const after = Number(url.searchParams.get("after")) || 0;
    result = {
      ...events,
      items: events.items.filter((e) => e.seq > after),
      has_more: false,
    };
  } else if (url.pathname === "/api/agents") {
    result = fixed["/api/agents?limit=30"];
  } else if (url.pathname === "/api/memory/search") {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    const nodes = snapshot.fixed["/api/memory"].nodes as GraphNode[];
    result = {
      items: nodes
        .filter((n) => JSON.stringify(n).toLowerCase().includes(q))
        .slice(0, 50)
        .map((n) => ({ ...n, score: 1 })),
      truncated: false,
    };
  } else if (url.pathname === "/api/memory/withdrawal") {
    result = (snapshot.withdrawals as Record<string, unknown>)[
      url.searchParams.get("finding_id") ?? ""
    ];
  } else {
    result = fixed[url.pathname];
  }
  if (result === undefined)
    throw new ApiError(
      "This record is not included in the public demo.",
      404,
      "demo_not_recorded",
    );
  return structuredClone(result) as T;
}
