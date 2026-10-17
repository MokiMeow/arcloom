import { useEffect, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowRight,
  Database,
  Fingerprint,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { ApiError, errorText, request, setCsrf, useRemote } from "./api";
import type { Catalog, Dashboard, Discovery, Session } from "./types";
import { Activity } from "./components/Activity";
import { CaseDetail } from "./components/CaseDetail";
import { Investigations } from "./components/Investigations";
import { Memory } from "./components/Memory";
import { Overview } from "./components/Overview";
import { ReportForm } from "./components/ReportForm";
import { Settings } from "./components/Settings";
import { ErrorNotice, Loading } from "./components/ui";

type View = "overview" | "investigations" | "memory" | "activity" | "settings";
const navigation = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "investigations", label: "Investigations", icon: GitBranch },
  { id: "memory", label: "Memory graph", icon: Database },
  { id: "activity", label: "Activity & evidence", icon: ActivityIcon },
  { id: "settings", label: "Workspace policy", icon: Settings2 },
] as const;

function Login({ authenticated }: { authenticated: (s: Session) => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await request<Session>("/api/auth/login", "POST", {
        token,
      });
      setToken("");
      authenticated(result);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-screen">
      <section className="login-story">
        <div className="brand large">
          <span className="brand-symbol">a</span>arcloom
          <span className="brand-period">.</span>
        </div>
        <div>
          <p className="eyebrow">Persistent security intelligence</p>
          <h1>
            Good investigations
            <br />
            should leave
            <br />
            something behind.
          </h1>
          <p className="lead">
            Connected findings. Verifiable evidence.
            <br />A better starting point for the next agent.
          </p>
        </div>
        <div className="login-path">
          <span>
            <Fingerprint size={19} />
            Finding
          </span>
          <ArrowRight size={16} />
          <span>
            <Database size={19} />
            Memory
          </span>
          <ArrowRight size={16} />
          <span>
            <Sparkles size={19} />
            Discovery
          </span>
        </div>
        <p className="footnote">
          Built around FalkorDB. Restricted to a controlled synthetic lab.
        </p>
      </section>
      <section className="login-panel">
        <form onSubmit={submit}>
          <span className="login-lock">
            <ShieldCheck size={25} />
          </span>
          <p className="eyebrow">Your investigation workspace</p>
          <h2>Open Arcloom.</h2>
          <p className="body-copy">
            Use the access token generated during setup or shared by your
            workspace owner.
          </p>
          <label>
            Workspace access token
            <input
              aria-label="Workspace access token"
              type="password"
              autoComplete="one-time-code"
              required
              minLength={32}
              maxLength={256}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your private access token"
            />
          </label>
          <ErrorNotice message={error} />
          <button className="button primary login-submit" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ArrowRight size={16} />
            )}
            Enter workspace
          </button>
          <p className="footnote">
            Your token is exchanged for an HttpOnly session. It is not stored in
            browser local storage.
          </p>
        </form>
      </section>
    </main>
  );
}

function Workspace({
  session,
  signOut,
}: {
  session: Session;
  signOut: () => void;
}) {
  const [view, setView] = useState<View>("overview");
  const [caseId, setCaseId] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const d = useRemote<Dashboard>("/api/dashboard", revision, 2500);
  const catalog = useRemote<Catalog>("/api/catalog", 0);
  const canWrite = session.actor.role !== "viewer";
  const changed = () => setRevision((v) => v + 1);
  function openCase(id: string) {
    setCaseId(id);
    setView("investigations");
    setNotice(null);
  }
  async function discover() {
    setBusy(true);
    setNotice(null);
    try {
      const r = await request<Discovery>("/api/agents/discover", "POST", {});
      changed();
      if (r.case_id) openCase(r.case_id);
      else
        setNotice(
          r.reason ??
            "No new candidates. Verify and review a source finding first.",
        );
    } catch (e) {
      setNotice(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await request("/api/auth/logout", "POST");
      signOut();
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  const reviewCount =
    (d.data?.counts.awaiting_approval ?? 0) +
    (d.data?.counts.awaiting_review ?? 0);
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => {
            setView("overview");
            setCaseId(null);
          }}
          aria-label="Arcloom overview"
        >
          <span className="brand-symbol">a</span>arcloom
          <span className="brand-period">.</span>
        </button>
        <div className="workspace-chip">
          <span className="workspace-initial">L</span>
          <div>
            <strong>{session.actor.tenant}</strong>
            <small>Security workspace</small>
          </div>
          <span className="badge">LAB</span>
        </div>
        <p className="nav-caption">Workspace</p>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${view === n.id ? "active" : ""}`}
              aria-current={view === n.id ? "page" : undefined}
              onClick={() => {
                setView(n.id);
                setCaseId(null);
                setNotice(null);
              }}
            >
              <n.icon size={17} />
              <span>{n.label}</span>
              {n.id === "investigations" && reviewCount > 0 && (
                <span className="nav-count">{reviewCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={18} />
          <strong>Evidence before certainty.</strong>
          <p>
            An agent may propose. It cannot authorize a test or confirm its own
            finding.
          </p>
        </div>
        <div className="sidebar-bottom">
          <div className="memory-status">
            <span
              className={`status-light ${d.data?.memory.in_sync ? "on" : ""}`}
            />
            <div>
              <strong>FalkorDB memory</strong>
              <small>
                {d.data?.memory.in_sync
                  ? "Connected & synchronized"
                  : "Waiting for synchronization"}
              </small>
            </div>
          </div>
          <button className="account-button" onClick={() => void logout()}>
            <span className="avatar">
              {session.actor.role[0].toUpperCase()}
            </span>
            <span>
              {session.actor.role}
              <small>Private session</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>
              {caseId
                ? "Investigation detail"
                : navigation.find((n) => n.id === view)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="badge scope-badge">
              <ShieldCheck size={12} />
              {d.data?.scope_enabled ? "Authorized lab" : "Admission paused"}
            </span>
            <span className="revision-pill">{d.data?.revision ?? "…"}</span>
            {canWrite && (
              <button
                className="button small-button"
                onClick={() => setShowReport(true)}
                disabled={!catalog.data}
              >
                <Plus size={15} />
                New report
              </button>
            )}
          </div>
        </header>
        <div className="mode-bar">
          <span>
            <span className="dot" />
            {d.data?.model.live_llm
              ? `Live ${d.data.model.provider} adapter · ${d.data.model.model}`
              : "Deterministic planner · no live LLM calls"}
          </span>
          <span>Controlled synthetic fixtures · no production targets</span>
        </div>
        <main id="main-content" className="main-content">
          <ErrorNotice message={d.error || catalog.error || notice} />
          {d.loading && !d.data ? (
            <Loading />
          ) : d.data ? (
            <>
              {view === "overview" && (
                <Overview
                  dashboard={d.data}
                  revision={revision}
                  openCase={openCase}
                  discover={() => void discover()}
                  busy={
                    busy || !["admin", "reviewer"].includes(session.actor.role)
                  }
                />
              )}
              {view === "investigations" &&
                (caseId ? (
                  <CaseDetail
                    key={caseId}
                    id={caseId}
                    revision={revision}
                    back={() => setCaseId(null)}
                    changed={changed}
                    openCase={openCase}
                    role={session.actor.role}
                  />
                ) : (
                  <Investigations
                    revision={revision}
                    openCase={openCase}
                    newReport={() => setShowReport(true)}
                  />
                ))}
              {view === "memory" && (
                <Memory revision={revision} openCase={openCase} />
              )}
              {view === "activity" && (
                <Activity revision={revision} openCase={openCase} />
              )}
              {view === "settings" && (
                <Settings
                  dashboard={d.data}
                  revision={revision}
                  changed={changed}
                  role={session.actor.role}
                />
              )}
            </>
          ) : null}
        </main>
        <footer className="workspace-footer">
          <span>ARCLOOM / Graph-native security memory</span>
          <span>Hypothesis ≠ finding. Historical ≠ current.</span>
        </footer>
      </div>
      {showReport && catalog.data && (
        <ReportForm
          catalog={catalog.data}
          close={() => setShowReport(false)}
          created={(id) => {
            setShowReport(false);
            changed();
            openCase(id);
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function authenticate(s: Session) {
    setCsrf(s.csrf);
    setSession(s);
  }
  useEffect(() => {
    const abort = new AbortController();
    void request<Session>("/api/auth/session", "GET", undefined, abort.signal)
      .then(authenticate)
      .catch((e) => {
        if (
          !(e instanceof ApiError && e.status === 401) &&
          !(e instanceof DOMException && e.name === "AbortError")
        )
          setError(errorText(e));
      })
      .finally(() => setReady(true));
    return () => abort.abort();
  }, []);
  if (!ready) return <Loading />;
  return session ? (
    <Workspace
      session={session}
      signOut={() => {
        setCsrf(null);
        setSession(null);
      }}
    />
  ) : (
    <>
      <ErrorNotice message={error} />
      <Login authenticated={authenticate} />
    </>
  );
}
