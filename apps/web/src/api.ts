import { useCallback, useEffect, useRef, useState } from "react";

let csrf: string | null = null;
export function setCsrf(value: string | null): void {
  csrf = value;
}
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  constructor(
    message: string,
    status: number,
    code: string,
    requestId?: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (import.meta.env.VITE_PUBLIC_DEMO === "true") {
    const { demoRequest } = await import("./demo/api");
    return demoRequest<T>(path, method, signal);
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["Idempotency-Key"] = crypto.randomUUID();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (
    response.status === 401 &&
    !signal?.aborted &&
    path !== "/api/auth/session" &&
    path !== "/api/auth/login" &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(new Event("arcloom:session-expired"));
  }
  if (response.status === 204) return undefined as T;
  let data;
  try {
    data = await response.json();
  } catch (error) {
    if (signal?.aborted) throw error;
    if (response.ok) {
      throw new ApiError(
        "The server returned an invalid JSON response. Please try again.",
        response.status,
        "invalid_response",
      );
    }
  }
  if (!response.ok) {
    throw new ApiError(
      data?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      data?.error?.code ?? "http_error",
      data?.request_id,
    );
  }
  return data as T;
}
export function errorText(error: unknown): string {
  return error instanceof ApiError
    ? `${error.message}${error.requestId ? ` · Request ${error.requestId}` : ""}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
}
export function useRemote<T>(
  path: string | null,
  revision: number,
  interval = 0,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const previousPath = useRef(path);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const id = ++sequence.current;
      pending.current?.abort();
      pending.current = null;
      if (!path) {
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }
      const abort = new AbortController();
      pending.current = abort;
      const cancel = () => abort.abort();
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
      try {
        const value = await request<T>(path, "GET", undefined, abort.signal);
        if (id === sequence.current && !abort.signal.aborted) {
          setData(value);
          setError(null);
        }
      } catch (e) {
        if (!abort.signal.aborted && id === sequence.current)
          setError(errorText(e));
      } finally {
        signal?.removeEventListener("abort", cancel);
        if (pending.current === abort) pending.current = null;
        if (id === sequence.current && !abort.signal.aborted) setLoading(false);
      }
    },
    [path],
  );
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    if (previousPath.current !== path) setData(null);
    previousPath.current = path;
    setError(null);
    void refresh(abort.signal);
    const timer = interval
      ? window.setInterval(() => {
          if (!document.hidden && !pending.current) void refresh(abort.signal);
        }, interval)
      : undefined;
    return () => {
      sequence.current += 1;
      abort.abort();
      pending.current?.abort();
      pending.current = null;
      if (timer) window.clearInterval(timer);
    };
  }, [path, refresh, revision, interval]);
  return { data, error, loading, refresh };
}
