// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request, useRemote } from "./api";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("API responses", () => {
  it("announces an expired workspace session while retaining the 401 error", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "unauthorized", message: "Session expired" } },
            { status: 401 },
          ),
        ),
    );
    const expired = vi.fn();
    window.addEventListener("arcloom:session-expired", expired);
    try {
      await expect(request("/api/dashboard")).rejects.toMatchObject({
        status: 401,
      });
      expect(expired).toHaveBeenCalledOnce();
    } finally {
      window.removeEventListener("arcloom:session-expired", expired);
    }
  });

  it.each(["/api/auth/session", "/api/auth/login"])(
    "keeps expected authentication failures local to %s",
    async (path) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { error: { code: "unauthorized", message: "Not authenticated" } },
              { status: 401 },
            ),
          ),
      );
      const expired = vi.fn();
      window.addEventListener("arcloom:session-expired", expired);
      try {
        await expect(request(path)).rejects.toMatchObject({ status: 401 });
        expect(expired).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener("arcloom:session-expired", expired);
      }
    },
  );

  it("does not end a newer session when an aborted request returns a late 401", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const expired = vi.fn();
    const abort = new AbortController();
    window.addEventListener("arcloom:session-expired", expired);
    try {
      const result = request("/api/dashboard", "GET", undefined, abort.signal);
      abort.abort();
      pending.resolve(
        Response.json(
          { error: { code: "unauthorized", message: "Old session" } },
          { status: 401 },
        ),
      );
      await expect(result).rejects.toMatchObject({ status: 401 });
      expect(expired).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("arcloom:session-expired", expired);
    }
  });

  it("rejects an HTML success page instead of returning null workspace data", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>Proxy error</html>", { status: 200 }),
        ),
    );
    await expect(request("/api/dashboard")).rejects.toMatchObject({
      status: 200,
      code: "invalid_response",
    });
  });

  it("preserves structured API errors and their request identifiers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: { message: "Access denied", code: "forbidden" },
            request_id: "req-42",
          },
          { status: 403 },
        ),
      ),
    );
    await expect(request("/api/dashboard")).rejects.toMatchObject({
      message: "Access denied",
      status: 403,
      code: "forbidden",
      requestId: "req-42",
    });
  });

  it("reports an HTTP error even when a proxy returns a non-JSON error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })),
    );
    await expect(request("/api/dashboard")).rejects.toBeInstanceOf(ApiError);
    await expect(request("/api/dashboard")).rejects.toMatchObject({
      status: 502,
      code: "http_error",
    });
  });
});

describe("remote resources", () => {
  it("keeps the current resource visible while a revision refresh is pending", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ title: "Current" }))
        .mockReturnValueOnce(pending.promise),
    );
    const { result, rerender } = renderHook(
      ({ revision }) =>
        useRemote<{ title: string }>("/api/dashboard", revision),
      { initialProps: { revision: 0 } },
    );
    await waitFor(() =>
      expect(result.current.data).toEqual({ title: "Current" }),
    );

    rerender({ revision: 1 });
    expect(result.current.data).toEqual({ title: "Current" });
    expect(result.current.loading).toBe(true);
    await act(async () => {
      pending.resolve(Response.json({ title: "Refreshed" }));
    });
    expect(result.current.data).toEqual({ title: "Refreshed" });
    expect(result.current.loading).toBe(false);
  });

  it("retains last good data and reports the error when a revision refresh fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ title: "Current" }))
        .mockRejectedValueOnce(new Error("Refresh unavailable")),
    );
    const { result, rerender } = renderHook(
      ({ revision }) =>
        useRemote<{ title: string }>("/api/dashboard", revision),
      { initialProps: { revision: 0 } },
    );
    await waitFor(() =>
      expect(result.current.data).toEqual({ title: "Current" }),
    );

    rerender({ revision: 1 });
    await waitFor(() =>
      expect(result.current.error).toBe("Refresh unavailable"),
    );
    expect(result.current.data).toEqual({ title: "Current" });
    expect(result.current.loading).toBe(false);
  });

  it("clears data from a different resource while the new URL loads", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ title: "Old private data" }))
        .mockReturnValueOnce(new Promise(() => {})),
    );
    const { result, rerender } = renderHook(
      ({ path }) => useRemote<{ title: string }>(path, 0),
      { initialProps: { path: "/api/old" } },
    );
    await waitFor(() =>
      expect(result.current.data).toEqual({ title: "Old private data" }),
    );

    rerender({ path: "/api/new" });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("discards an in-flight result when the resource is disabled", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
    const { result, rerender } = renderHook(
      ({ path }) => useRemote<{ title: string }>(path, 0),
      { initialProps: { path: "/api/old" as string | null } },
    );
    rerender({ path: null });
    await act(async () => {
      pending.resolve(Response.json({ title: "Old private data" }));
    });
    expect(result.current).toMatchObject({
      data: null,
      error: null,
      loading: false,
    });
  });

  it("clears a previous resource's error when changing paths", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("Old resource failed"))
        .mockReturnValue(pending.promise),
    );
    const { result, rerender } = renderHook(({ path }) => useRemote(path, 0), {
      initialProps: { path: "/api/old" },
    });
    await waitFor(() =>
      expect(result.current.error).toBe("Old resource failed"),
    );
    rerender({ path: "/api/new" });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("keeps a slow poll from overlapping subsequent requests", async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const fetcher = vi.fn().mockReturnValue(pending.promise);
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() =>
      useRemote<{ count: number }>("/api/dashboard", 0, 1000),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(Response.json({ count: 4 }));
    });
    expect(result.current.data).toEqual({ count: 4 });
  });

  it("does not let an older path overwrite a newer result", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(Response.json({ title: "New" })),
    );
    const { result, rerender } = renderHook(
      ({ path }) => useRemote<{ title: string }>(path, 0),
      { initialProps: { path: "/api/old" } },
    );
    rerender({ path: "/api/new" });
    await waitFor(() => expect(result.current.data).toEqual({ title: "New" }));
    await act(async () => {
      pending.resolve(Response.json({ title: "Old" }));
    });
    expect(result.current.data).toEqual({ title: "New" });
  });
});
