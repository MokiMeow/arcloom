import { Fragment, lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  Database,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  Search,
  Bell,
  Plus,
  Settings2,
  ShieldCheck,
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
import { PUBLIC_DEMO, demoScenario } from "./demoMode";
import { Landing } from "./components/Landing";
import { CommandPalette } from "./components/CommandPalette";

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

function Workspace({
  session,
  signOut,
  onSessionUpdated,
}: {
  session: Session;
  signOut: () => void;
  onSessionUpdated: (session: Session) => void;
}) {
  const [route, setRoute] = useState(() => readLocation());
  const { view, caseId } = route;
  const routeState = useRef({
    location: locationFor(view, caseId),
    version: 0,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [showReport, setShowReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const d = useRemote<Dashboard>("/api/dashboard", revision, 2500);
  const catalog = useRemote<Catalog>("/api/catalog", 0);
  const canWrite = session.actor.role !== "viewer";
  const browserToolsAvailable = useWorkspaceAgentTools(
    PUBLIC_DEMO ? null : session,
  );
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
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!showReport && !menuOpen) setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [showReport, menuOpen]);
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
    <div
      className={`app-shell ${compact ? "compact-sidebar" : ""} ${menuOpen ? "navigation-open" : ""} ${PUBLIC_DEMO ? "public-demo" : ""}`}
    >
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
          <span className="brand-name">Arcloom</span>
        </button>
        <button
          className="sidebar-collapse icon-button"
          aria-label={compact ? "Expand sidebar" : "Collapse sidebar"}
          onClick={() => setCompact((value) => !value)}
        >
          <PanelLeftClose size={17} />
        </button>
        <div className="workspace-chip">
          <span className="workspace-initial">
            {session.actor.tenant[0]?.toUpperCase()}
          </span>
          <div>
            <strong title={session.actor.tenant}>{session.actor.tenant}</strong>
            <small>Investigation workspace</small>
          </div>
          <span className="badge">{PUBLIC_DEMO ? "DEMO" : "LAB"}</span>
        </div>
        <p className="nav-caption">Workspace</p>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <Fragment key={n.id}>
              {n.id === "memory" && (
                <p className="nav-caption nav-section-caption">Knowledge</p>
              )}
              {n.id === "settings" && (
                <p className="nav-caption nav-section-caption">
                  Administration
                </p>
              )}
              <button
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
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="sidebar-note-label">
            <ShieldCheck size={15} /> People make the call.
          </span>
          <p>Review the test. Inspect the evidence. Keep the context.</p>
          <button onClick={() => navigate("investigations")}>
            Review investigations <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="memory-status">
            <span
              className={`status-light ${d.data?.memory.in_sync ? "on" : ""}`}
            />
            <div>
              <strong>
                {PUBLIC_DEMO ? "FalkorDB snapshot" : "FalkorDB memory"}
              </strong>
              <small>
                {PUBLIC_DEMO
                  ? "Recorded synthetic data"
                  : d.data?.memory.in_sync
                    ? "Connected & synchronized"
                    : "Waiting for synchronization"}
              </small>
            </div>
          </div>
          <button
            className="account-button"
            aria-label={
              PUBLIC_DEMO ? "Read-only demo viewer" : "Sign out of workspace"
            }
            title={
              PUBLIC_DEMO ? "Read-only public demo" : "Sign out of workspace"
            }
            disabled={PUBLIC_DEMO}
            onClick={() => void logout()}
          >
            <span className="avatar">
              {(session.actor.name || session.actor.role)[0].toUpperCase()}
            </span>
            <span>
              {session.actor.name || session.actor.role}
              <small>{PUBLIC_DEMO ? "Public demo" : "Private session"}</small>
            </span>
            {!PUBLIC_DEMO && <LogOut size={16} />}
          </button>
        </div>
      </aside>
      <div className="workspace-main" inert={menuOpen}>
        {PUBLIC_DEMO && (
          <section
            className="public-demo-banner"
            aria-label="Public demo information"
          >
            <div>
              <strong>Interactive UI demo</strong>
              <p>
                Explore recorded synthetic investigations. Live execution and
                configuration changes are disabled.
              </p>
            </div>
            <label>
              Recorded state
              <select
                aria-label="Recorded demo state"
                value={demoScenario()}
                onChange={(e) => {
                  window.location.assign(
                    `${window.location.pathname}?scenario=${e.target.value}#/overview`,
                  );
                }}
              >
                <option value="r1">r1 · reviewed investigation</option>
                <option value="r2">r2 · after the patch</option>
              </select>
            </label>
            <div className="demo-links">
              <a
                href="https://youtu.be/Z8RMloVLsig"
                target="_blank"
                rel="noreferrer"
              >
                Watch the demo
              </a>
              <a
                href="https://github.com/MokiMeow/arcloom#run-locally"
                target="_blank"
                rel="noreferrer"
              >
                Run the full application
              </a>
            </div>
          </section>
        )}
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
            <button
              className="workspace-search"
              aria-label="Open command menu"
              onClick={() => setCommandOpen(true)}
            >
              <Search size={15} />
              <span>Quick navigation</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button decision-notification"
              aria-label={`Open decision queue, ${reviewCount} pending decisions`}
              onClick={() => navigate("investigations")}
            >
              <Bell size={17} />
              {reviewCount > 0 && <span>{reviewCount}</span>}
            </button>
            <span className="badge scope-badge">
              <ShieldCheck size={12} />
              {PUBLIC_DEMO
                ? "Demo snapshot"
                : d.data?.scope_enabled
                  ? d.data.scope_expires_at <= d.data.at
                    ? "Assessment expired"
                    : "Authorized lab"
                  : "Admission paused"}
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
            {PUBLIC_DEMO
              ? "Recorded UI demo · no live model or database calls"
              : d.data?.model.decision_model
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
                  layoutOwner={`${session.actor.tenant}:${session.actor.id}`}
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
                  session={session}
                  onSessionUpdated={onSessionUpdated}
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
      {commandOpen && (
        <CommandPalette
          onNavigate={(next) => navigate(next)}
          onNewReport={() => setShowReport(true)}
          canWrite={canWrite && Boolean(catalog.data)}
          onClose={() => setCommandOpen(false)}
        />
      )}
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
    setError(null);
  }
  useEffect(() => {
    const expire = () => {
      setCsrf(null);
      setSession(null);
      setError("Your session expired. Sign in to continue.");
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
      onSessionUpdated={authenticate}
      signOut={() => {
        setCsrf(null);
        setSession(null);
      }}
    />
  ) : (
    <Landing authenticated={authenticate} statusMessage={error} />
  );
}
