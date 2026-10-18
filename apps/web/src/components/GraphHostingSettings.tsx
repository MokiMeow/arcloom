import { useEffect, useRef, useState } from "react";
import { errorText, request, useRemote } from "../api";
import type { Role } from "../types";
import { ErrorNotice } from "./ui";

interface GraphEndpoint {
  host: string;
  port: number;
  username: string;
  ssl: boolean;
}
interface GraphHostingStatus {
  current: GraphEndpoint & { prefix: string };
  target: (GraphEndpoint & { password_configured: boolean }) | null;
  staged: boolean;
}
interface Props {
  revision: number;
  role: Role;
}

export function GraphHostingSettings({ revision, role }: Props) {
  return role === "admin" ? <GraphHostingForm revision={revision} /> : null;
}

function GraphHostingForm({ revision }: { revision: number }) {
  const remote = useRemote<GraphHostingStatus>("/api/graph-hosting", revision);
  const [draft, setDraft] = useState<GraphEndpoint | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const state = remote.data;
  const target = state?.target;
  const targetIsCurrent =
    !!target &&
    !!state?.current &&
    state.current.host.trim().toLowerCase() ===
      target.host.trim().toLowerCase() &&
    state.current.port === target.port &&
    state.current.username === target.username &&
    state.current.ssl === target.ssl;
  const selected = draft ??
    target ?? { host: "", port: 6379, username: "falkordb", ssl: false };
  const preservePassword =
    !!target?.password_configured &&
    selected.host.trim().toLowerCase() === target.host.trim().toLowerCase() &&
    selected.port === target.port &&
    selected.username.trim() === target.username.trim();

  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [],
  );

  function update(patch: Partial<GraphEndpoint>) {
    setDraft({ ...selected, ...patch });
    setSaved(false);
    setError(null);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setSaved(false);
    if (!password && !preservePassword) {
      setError(
        "Enter a password for this target. A saved password only applies to the same host, port, and username.",
      );
      return;
    }
    const abort = new AbortController();
    pending.current = abort;
    setBusy(true);
    try {
      await request<GraphHostingStatus>(
        "/api/graph-hosting/target",
        "POST",
        {
          host: selected.host.trim(),
          port: selected.port,
          username: selected.username.trim(),
          ssl: selected.ssl,
          ...(password ? { password } : {}),
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setPassword("");
      setDraft(null);
      setSaved(true);
      await remote.refresh(abort.signal);
    } catch (e) {
      if (!abort.signal.aborted) setError(errorText(e));
    } finally {
      if (!abort.signal.aborted) {
        setPassword("");
        setBusy(false);
      }
    }
  }

  return (
    <section className="panel padded" aria-labelledby="graph-hosting-heading">
      <p className="eyebrow">Graph hosting</p>
      <h2 id="graph-hosting-heading">Cloud graph connection</h2>
      <p className="body-copy">
        Stage your FalkorDB Cloud connection privately. Existing local data
        remains in place until an operator completes and verifies migration.
      </p>
      <ErrorNotice message={error || remote.error} />
      {remote.loading && !state && (
        <p role="status" className="footnote">
          Loading graph connection…
        </p>
      )}
      {state?.current && (
        <dl className="property-list">
          <div>
            <dt>Current graph server</dt>
            <dd>
              {state.current.host}:{state.current.port}
            </dd>
          </div>
          <div>
            <dt>Current graph prefix</dt>
            <dd>{state.current.prefix}</dd>
          </div>
          <div>
            <dt>Staged cloud target</dt>
            <dd>
              {target ? `${target.host}:${target.port}` : "No target staged"}
            </dd>
          </div>
          <div>
            <dt>Migration status</dt>
            <dd>
              {targetIsCurrent
                ? "Cloud target is configured as the current graph server"
                : state.staged
                  ? "Connection staged; migration is separate"
                  : "No cloud connection staged"}
            </dd>
          </div>
        </dl>
      )}
      {saved && (
        <p className="notice success" role="status">
          Cloud connection staged. The current graph server has not changed.
        </p>
      )}
      <form
        aria-label="Cloud graph connection"
        onSubmit={(event) => void save(event)}
      >
        <label>
          Cloud endpoint (host)
          <input
            required
            maxLength={253}
            autoComplete="off"
            disabled={busy || !state}
            value={selected.host}
            placeholder="Your instance hostname"
            onChange={(event) => update({ host: event.target.value })}
          />
        </label>
        <label>
          Cloud port
          <input
            type="number"
            required
            min={1}
            max={65535}
            step={1}
            disabled={busy || !state}
            value={selected.port || ""}
            onChange={(event) => update({ port: Number(event.target.value) })}
          />
        </label>
        <label>
          Cloud username
          <input
            required
            maxLength={100}
            autoComplete="off"
            disabled={busy || !state}
            value={selected.username}
            onChange={(event) => update({ username: event.target.value })}
          />
        </label>
        <label>
          Cloud password
          <input
            type="password"
            required={!preservePassword}
            autoComplete="new-password"
            spellCheck={false}
            disabled={busy || !state}
            value={password}
            aria-describedby="cloud-password-help"
            onChange={(event) => {
              setPassword(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <p id="cloud-password-help" className="footnote">
          {preservePassword
            ? "Password configured. Leave blank to keep this target’s saved password."
            : "Enter a password for this target. Changing the host, port, or username requires a password."}{" "}
          Passwords are kept on the server and never returned to this form.
        </p>
        <label className="graph-tls-option">
          <input
            type="checkbox"
            checked={selected.ssl}
            disabled={busy || !state}
            onChange={(event) => update({ ssl: event.target.checked })}
          />{" "}
          TLS enabled
        </label>
        <p className="footnote">
          FalkorDB Cloud Free has no TLS or data persistence. Use it only for
          disposable synthetic lab data. Match TLS to your instance’s connection
          settings.
        </p>
        <button className="button" disabled={busy || !state}>
          {busy ? "Saving cloud connection…" : "Save cloud connection"}
        </button>
        <p className="footnote">
          Saving stages credentials only. It does not test connectivity, copy
          data, or switch the current graph server.
        </p>
      </form>
    </section>
  );
}
