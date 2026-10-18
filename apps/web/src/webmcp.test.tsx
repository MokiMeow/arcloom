// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerWorkspaceTools,
  useWorkspaceAgentTools,
  type BrowserAgentTool,
} from "./webmcp";
import type { Session } from "./types";

const session: Session = {
  actor: { id: "member_1", tenant: "lab", role: "viewer" },
  csrf: null,
};
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "modelContext");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function browser() {
  const registered: BrowserAgentTool[] = [];
  const signals: AbortSignal[] = [];
  const registerTool = vi.fn(
    (tool: BrowserAgentTool, options: { signal: AbortSignal }) => {
      registered.push(tool);
      signals.push(options.signal);
    },
  );
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: { registerTool },
  });
  return { registered, signals, registerTool };
}
async function tools() {
  const state = browser();
  const available = vi.fn();
  const stop = registerWorkspaceTools(session, available);
  await waitFor(() => expect(available).toHaveBeenLastCalledWith(true));
  return { ...state, stop, available };
}
describe("optional browser workspace tools", () => {
  it("keeps ordinary browsers and unauthenticated mounts inert", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useWorkspaceAgentTools(session));
    expect(result.current).toBe(false);
    const { registerTool } = browser();
    registerWorkspaceTools(null, vi.fn());
    expect(registerTool).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("registers exactly three read-only tools and unregisters on logout", async () => {
    const { registered, signals, stop } = await tools();
    expect(registered.map((tool) => tool.name)).toEqual([
      "arcloom_handoff",
      "arcloom_investigations",
      "arcloom_investigation",
    ]);
    expect(
      registered.every(
        (tool) =>
          tool.annotations.readOnlyHint &&
          tool.annotations.untrustedContentHint,
      ),
    ).toBe(true);
    expect(session.actor.role).toBe("viewer");
    stop();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
  it("uses same-origin authenticated GET reads and returns actual structured data as JSON", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ revision: "r2" })));
    vi.stubGlobal("fetch", fetch);
    const { registered, stop } = await tools();
    expect(JSON.parse(await registered[0].execute({}))).toEqual({
      revision: "r2",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/memory/handoff",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        signal: expect.any(AbortSignal),
      }),
    );
    await registered[1].execute({ limit: 20 });
    expect(fetch.mock.calls[1][0]).toBe("/api/investigations?limit=20");
    await registered[2].execute({ case_id: "case_abc123" });
    expect(fetch.mock.calls[2][0]).toBe("/api/investigations/case_abc123");
    expect(
      fetch.mock.calls.every(([, options]) => !options.headers.Authorization),
    ).toBe(true);
    stop();
  });
  it("validates every input at runtime before fetching", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { registered, stop } = await tools();
    const cases: [number, unknown][] = [
      [0, { url: "https://example.com" }],
      [0, null],
      [1, { limit: 21 }],
      [1, { limit: 0 }],
      [1, { limit: 1.5 }],
      [1, { limit: "5" }],
      [1, { limit: 2, query: "MATCH" }],
      [2, {}],
      [2, { case_id: "../../auth" }],
      [2, { case_id: "https://example.com" }],
      [2, { case_id: `case_${"a".repeat(81)}` }],
    ];
    for (const [index, input] of cases)
      expect(
        JSON.parse(await registered[index].execute(input)).error.code,
      ).toBe("invalid_input");
    expect(fetch).not.toHaveBeenCalled();
    stop();
  });
  it("sanitizes authorization and upstream failures", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: "sensitive upstream detail" } }),
            { status: 403 },
          ),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const { registered, stop } = await tools();
    const denied = await registered[0].execute({});
    expect(JSON.parse(denied).error.code).toBe("access_denied");
    expect(denied).not.toContain("sensitive");
    fetch.mockRejectedValueOnce(new Error("private server credentials"));
    expect(await registered[0].execute({})).not.toContain("credentials");
    stop();
  });
  it("cancels in-flight calls on cleanup and refuses stale results", async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const { registered, stop } = await tools();
    const result = registered[0].execute({});
    stop();
    expect(fetch.mock.calls[0]).toBeDefined();
    finish(new Response(JSON.stringify({ secret: "stale result" })));
    expect(JSON.parse(await result).error.code).toBe("cancelled");
    await registered[0].execute({});
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("forwards agent cancellation to fetch", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const { registered, stop } = await tools();
    const abort = new AbortController();
    abort.abort();
    expect(
      JSON.parse(await registered[0].execute({}, { signal: abort.signal }))
        .error.code,
    ).toBe("cancelled");
    expect(fetch).not.toHaveBeenCalled();
    stop();
  });
  it("cleans up partial registration and never claims availability on failure", async () => {
    const { registerTool } = browser();
    registerTool
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("unavailable");
      });
    const available = vi.fn();
    registerWorkspaceTools(session, available);
    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(2));
    expect(available).not.toHaveBeenCalledWith(true);
    expect(registerTool.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("does not re-register tools during unrelated workspace refreshes", async () => {
    const { registerTool, signals } = browser();
    const { result, rerender, unmount } = renderHook(
      ({ current }) => useWorkspaceAgentTools(current),
      { initialProps: { current: session as Session | null } },
    );
    await waitFor(() => expect(result.current).toBe(true));
    act(() =>
      rerender({ current: { ...session, actor: { ...session.actor } } }),
    );
    expect(registerTool).toHaveBeenCalledTimes(3);
    act(() => rerender({ current: null }));
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(result.current).toBe(false);
    unmount();
  });
});
