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
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
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
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!path) {
        setData(null);
        setLoading(false);
        return;
      }
      const id = ++sequence.current;
      try {
        const value = await request<T>(path, "GET", undefined, signal);
        if (id === sequence.current) {
          setData(value);
          setError(null);
        }
      } catch (e) {
        if (
          !(e instanceof DOMException && e.name === "AbortError") &&
          id === sequence.current
        )
          setError(errorText(e));
      } finally {
        if (id === sequence.current) setLoading(false);
      }
    },
    [path],
  );
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setData(null);
    void refresh(abort.signal);
    const timer = interval
      ? window.setInterval(() => {
          if (!document.hidden) void refresh(abort.signal);
        }, interval)
      : undefined;
    return () => {
      abort.abort();
      if (timer) window.clearInterval(timer);
    };
  }, [refresh, revision, interval]);
  return { data, error, loading, refresh };
}
