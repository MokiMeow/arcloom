import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowRight,
  Database,
  Fingerprint,
  GitBranch,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { ApiError, errorText, request, setCsrf, useRemote } from "./api";
import type { Catalog, Dashboard, Discovery, Session } from "./types";
import { Activity } from "./components/Activity";
import { CaseDetail } from "./components/CaseDetail";
import { Investigations } from "./components/Investigations";
import { Overview } from "./components/Overview";
import { ReportForm } from "./components/ReportForm";
import { Settings } from "./components/Settings";
import { ErrorNotice, Loading } from "./components/ui";
import { BrandMark } from "./components/Brand";
import { readLocation, locationFor, type View } from "./navigation";
import { useWorkspaceAgentTools } from "./webmcp";

const Memory = lazy(() =>
  import("./components/Memory").then((module) => ({ default: module.Memory })),
);

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
          <span className="brand-symbol">
            <BrandMark />
          </span>
          arcloom
          <span className="brand-period">.</span>
        </div>
        <div>
          <p className="eyebrow">A workspace for connected investigations</p>
          <h1>
            Every investigation
            <br />
            leaves a thread.
            <br />
            <em>Follow it further.</em>
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
        <div className="login-principle">
          <span className="mono">01 / EVIDENCE FIRST</span>
          <p>
            One reviewed finding becomes the next investigator’s starting point.
          </p>
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
          <h2>Welcome to Arcloom.</h2>
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
            Private by default. Your access token stays out of browser storage.
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
  const [route, setRoute] = useState(() => readLocation());
  const { view, caseId } = route;
  const routeState = useRef({
    location: locationFor(view, caseId),
    version: 0,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const d = useRemote<Dashboard>("/api/dashboard", revision, 2500);
  const catalog = useRemote<Catalog>("/api/catalog", 0);
  const canWrite = session.actor.role !== "viewer";
  const browserToolsAvailable = useWorkspaceAgentTools(session);
  const changed = () => setRevision((v) => v + 1);
  function navigate(view: View, caseId: string | null = null) {
    const next = locationFor(view, caseId);
    if (routeState.current.location !== next) {
      routeState.current = {
        location: next,
        version: routeState.current.version + 1,
      };
    }
    setRoute({ view, caseId });
    window.location.hash = next;
    setMenuOpen(false);
    setNotice(null);
  }
  function closeMenu() {
    setMenuOpen(false);
  }
  useEffect(() => {
    document.getElementById("main-content")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [view, caseId]);
  useEffect(() => {
    const sync = () => {
      const next = readLocation();
      const location = locationFor(next.view, next.caseId);
      if (routeState.current.location !== location) {
        routeState.current = {
          location,
          version: routeState.current.version + 1,
        };
      }
      setRoute(next);
      setMenuOpen(false);
      setNotice(null);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const sidebar = document.getElementById("workspace-navigation");
    const controls = () => [
      ...(sidebar?.querySelectorAll<HTMLButtonElement>("button") ?? []),
    ];
    const active = sidebar?.querySelector<HTMLButtonElement>(
      '[aria-current="page"]',
    );
    (active ?? controls()[0])?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
      if (event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
      document.getElementById("navigation-toggle")?.focus();
    };
  }, [menuOpen]);
  function openCase(id: string) {
    navigate("investigations", id);
  }
  async function discover() {
    const startedOn = routeState.current.version;
    setBusy(true);
    setNotice(null);
    try {
      const r = await request<Discovery>("/api/agents/discover", "POST", {});
      changed();
      if (startedOn !== routeState.current.version) return;
      if (r.case_id) openCase(r.case_id);
      else
        setNotice(
          r.reason ??
            "No eligible follow-ups on this revision. Inspect the handoff briefing for attempted tests and missing prerequisites.",
        );
    } catch (e) {
      if (startedOn === routeState.current.version) setNotice(errorText(e));
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
    <div className={`app-shell ${menuOpen ? "navigation-open" : ""}`}>
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("main-content");
          main?.focus();
          main?.scrollIntoView({ block: "start" });
        }}
      >
        Skip to main content
      </a>
      {menuOpen && (
        <button
          className="navigation-backdrop"
          tabIndex={-1}
          aria-label="Close navigation"
          onClick={closeMenu}
        />
      )}
      <aside
        className="sidebar"
        id="workspace-navigation"
        role={menuOpen ? "dialog" : undefined}
        aria-modal={menuOpen ? true : undefined}
        aria-label={menuOpen ? "Workspace navigation" : undefined}
      >
        {menuOpen && (
          <button
            className="icon-button drawer-close"
            aria-label="Close navigation"
            onClick={closeMenu}
          >
            <X size={20} />
          </button>
        )}
        <button
          className="brand"
          onClick={() => {
            navigate("overview");
          }}
          aria-label="Arcloom overview"
        >
          <span className="brand-symbol">
            <BrandMark />
          </span>
          arcloom
          <span className="brand-period">.</span>
        </button>
        <div className="workspace-chip">
          <span className="workspace-initial">
            {session.actor.tenant[0]?.toUpperCase()}
          </span>
          <div>
            <strong title={session.actor.tenant}>{session.actor.tenant}</strong>
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
              aria-label={n.label}
              title={n.label}
              onClick={() => {
                navigate(n.id);
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
          <strong>Follow the evidence.</strong>
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
          <button
            className="account-button"
            aria-label="Sign out of workspace"
            title="Sign out of workspace"
            onClick={() => void logout()}
          >
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
      <div className="workspace-main" inert={menuOpen}>
        <header className="topbar">
          <button
            id="navigation-toggle"
            className="icon-button navigation-toggle"
            aria-label={
              menuOpen ? "Close navigation menu" : "Open navigation menu"
            }
            aria-expanded={menuOpen}
            aria-controls="workspace-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
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
            {d.data?.model.decision_model
              ? `Cloudflare decision model · ${d.data.model.model}`
              : d.data?.model.live_llm
                ? `Live ${d.data.model.provider} adapter · ${d.data.model.model}`
                : "Deterministic planner · no live LLM calls"}
          </span>
          <span>Controlled synthetic fixtures · no production targets</span>
        </div>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <ErrorNotice message={d.error || catalog.error || notice} />
          {d.loading && !d.data ? (
            <Loading />
          ) : d.data ? (
            <>
              {view === "overview" && (
                <Overview
                  dashboard={d.data}
                  revision={revision}
                  browserToolsAvailable={browserToolsAvailable}
                  openCase={openCase}
                  discover={() => void discover()}
                  busy={
                    busy || !["admin", "reviewer"].includes(session.actor.role)
                  }
                  canWrite={canWrite}
                  canDiscover={["admin", "reviewer"].includes(
                    session.actor.role,
                  )}
                  newReport={() => setShowReport(true)}
                  openMemory={() => navigate("memory")}
                  openInvestigations={() => navigate("investigations")}
                />
              )}
              {view === "investigations" &&
                (caseId ? (
                  <CaseDetail
                    key={caseId}
                    id={caseId}
                    revision={revision}
                    back={() => navigate("investigations")}
                    changed={changed}
                    openCase={openCase}
                    role={session.actor.role}
                  />
                ) : (
                  <Investigations
                    revision={revision}
                    openCase={openCase}
                    newReport={() => setShowReport(true)}
                    canWrite={canWrite}
                  />
                ))}
              {view === "memory" && (
                <Suspense fallback={<Loading />}>
                  <Memory revision={revision} openCase={openCase} />
                </Suspense>
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
    const expire = () => {
      setCsrf(null);
      setSession(null);
      setError("Your session expired. Enter your workspace token to continue.");
    };
    window.addEventListener("arcloom:session-expired", expire);
    return () => window.removeEventListener("arcloom:session-expired", expire);
  }, []);
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
