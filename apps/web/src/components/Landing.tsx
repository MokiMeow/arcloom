import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Database,
  FileSearch,
  Fingerprint,
  GitBranch,
  Layers3,
  LockKeyhole,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import type { Session } from "../types";
import { BrandMark } from "./Brand";
import { AccountAccess } from "./AccountAccess";
import "./landing.css";

const stages = [
  {
    title: "Report",
    heading: "A clear signal. A proper starting point.",
    icon: FileSearch,
    body: "Capture an observation from a registered synthetic fixture. Keep the original researcher, assessment scope, and deployment revision attached from the beginning.",
    checkpoint: "Researcher submits an observation",
    outcome: "A report ready for review",
    sheetTitle: "Start with what you observed.",
    sheetNote: "A report is not yet a verified finding.",
    items: ["Registered fixture", "Original researcher", "Assessment scope"],
  },
  {
    title: "Approve",
    heading: "Good questions still need permission.",
    icon: ShieldCheck,
    body: "A human reviewer inspects the proposed scope and approves a bounded lab test. The agent can recommend the next move. It cannot authorize its own execution.",
    checkpoint: "Human execution approval",
    outcome: "An authorized lab observation",
    sheetTitle: "People approve the test.",
    sheetNote: "Registered fixtures. Explicit scope. Bounded work.",
    items: ["Reviewer decision", "Execution budget", "Revision-bound approval"],
  },
  {
    title: "Review",
    heading: "Put the evidence before the conclusion.",
    icon: Fingerprint,
    body: "Inspect the signed receipt and verify the stored bytes. A separate human acceptance decision turns a runner observation into an attributable, reviewed finding.",
    checkpoint: "Independent evidence acceptance",
    outcome: "A finding backed by accepted evidence",
    sheetTitle: "Review the actual evidence.",
    sheetNote: "Permission to run is not acceptance of a result.",
    items: [
      "Content-addressed evidence",
      "Signed receipt",
      "Explicit acceptance",
    ],
  },
  {
    title: "Continue",
    heading: "New investigator. Better context.",
    icon: GitBranch,
    body: "A fresh investigator retrieves current findings and prerequisite paths from FalkorDB. It proposes a supported follow-up without inheriting a previous conversation.",
    checkpoint: "Complete current graph prerequisites",
    outcome: "A new proposal needing fresh approval",
    sheetTitle: "Build on what is verified.",
    sheetNote: "Historical findings never silently become current.",
    items: [
      "Current accepted findings",
      "Supporting graph paths",
      "A new human checkpoint",
    ],
  },
];

const foundation = [
  {
    name: "Decision journal",
    icon: Layers3,
    title: "The record keeps the whole story.",
    copy: "SQLite owns transactional workflow state and the graph projection outbox. A hash-chained audit preserves who decided what, and when.",
    tags: ["Transactional state", "Attribution", "Audit history"],
  },
  {
    name: "Graph memory",
    icon: Database,
    title: "The connections have to hold up.",
    copy: "FalkorDB connects findings, capabilities, and eligible tests. Every prerequisite needs complete support from current, accepted evidence.",
    tags: ["Verified prerequisites", "Current revision", "Persistent context"],
  },
  {
    name: "Controlled lab",
    icon: ShieldCheck,
    title: "Useful work, with clear boundaries.",
    copy: "The authenticated runner executes registered synthetic fixtures. Explicit approvals, fenced jobs, and revision budgets keep the work bounded.",
    tags: ["Registered fixtures", "Human approval", "Execution budgets"],
  },
];

const questions = [
  [
    "Do I need a model API key?",
    "No. Arcloom starts with a deterministic planner that selects from graph-supported candidates. Optional model providers are selected explicitly in your private workspace settings.",
  ],
  [
    "Can an agent approve its own work?",
    "No. Execution approval and evidence acceptance are two separate human checkpoints. An agent can propose a bounded investigation, but it cannot authorize its own test or accept its own result.",
  ],
  [
    "What happens after a deployment changes?",
    "Earlier evidence stays in the record as historical memory. A finding must be revalidated on the active revision before it can support new eligible work.",
  ],
  [
    "Can I point Arcloom at any website?",
    "No. This application runs registered synthetic fixtures in a controlled lab. It does not accept arbitrary scan targets, generated shell commands, or production credentials.",
  ],
  [
    "What if graph memory is unavailable?",
    "Discovery and test admission fail closed. Arcloom reports unavailable memory or pending synchronization; it never replaces a failed graph read with invented prerequisites.",
  ],
];

const memoryJourney = [
  {
    title: "Scoped observation",
    label: "REPORT",
    icon: FileSearch,
    note: "An observation, not a conclusion.",
    detail:
      "A report enters the investigation with its original researcher, registered fixture, and deployment scope attached. It has not been verified yet.",
    principle: "Keep the source attached",
  },
  {
    title: "Human checkpoints",
    label: "REVIEW",
    icon: ShieldCheck,
    note: "People make two separate decisions.",
    detail:
      "A human approves execution before a bounded test runs. Afterward, a separate evidence acceptance decision is required before a finding can enter current memory.",
    principle: "Approval is not acceptance",
  },
  {
    title: "Accepted finding",
    label: "EVIDENCE",
    icon: Fingerprint,
    note: "Signed evidence. Explicit acceptance.",
    detail:
      "The stored evidence, its content hash, and the signed receipt are inspected. Only an explicitly accepted outcome becomes an attributable finding.",
    principle: "Build on reviewed evidence",
  },
  {
    title: "Connected memory",
    label: "FALKORDB",
    icon: Database,
    note: "Current support for the next question.",
    detail:
      "FalkorDB links accepted findings to required capabilities. A new investigation is eligible only when every prerequisite has current support at the active revision.",
    principle: "Check every prerequisite",
  },
];

function EvidenceWorkbench() {
  const [selected, setSelected] = useState(2);
  const id = useId();
  const current = memoryJourney[selected]!;
  return (
    <div className="sl-evidence-workbench">
      <div className="sl-workbench-heading">
        <span>
          <GitBranch size={14} />
          HOW KNOWLEDGE BECOMES A STARTING POINT
        </span>
        <span>
          Explore the connections
          <ArrowDown size={13} />
        </span>
      </div>
      <div
        className="sl-memory-canvas"
        role="group"
        aria-label="Explore the path from observation to connected memory"
      >
        <div className="sl-memory-grid" aria-hidden="true" />
        <svg
          className="sl-memory-paths"
          viewBox="0 0 1100 350"
          fill="none"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={`${id}-path`}>
              <stop stopColor="#76a8cb" />
              <stop offset=".5" stopColor="#397ec4" />
              <stop offset="1" stopColor="#76a8cb" />
            </linearGradient>
          </defs>
          <path
            d="M138 205C250 205 300 125 413 125S575 205 688 205 850 125 963 125"
            stroke={`url(#${id}-path)`}
          />
          <path
            className="sl-memory-path-pulse"
            d="M138 205C250 205 300 125 413 125S575 205 688 205 850 125 963 125"
          />
          <circle cx="274" cy="165" r="5" />
          <circle cx="550" cy="165" r="5" />
          <circle cx="826" cy="165" r="5" />
        </svg>
        {memoryJourney.map((item, index) => (
          <button
            type="button"
            id={`${id}-node-${index}`}
            key={item.label}
            className={`sl-memory-card sl-memory-card-${index}${selected === index ? " is-active" : ""}`}
            aria-label={`Explore ${item.title}`}
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
            onFocus={() => setSelected(index)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight")
                next = (index + 1) % memoryJourney.length;
              else if (event.key === "ArrowLeft")
                next =
                  (index + memoryJourney.length - 1) % memoryJourney.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = memoryJourney.length - 1;
              else return;
              event.preventDefault();
              setSelected(next);
              document.getElementById(`${id}-node-${next}`)?.focus();
            }}
          >
            <span className="sl-memory-card-top">
              <span>{item.label}</span>
              <ArrowUpRight size={13} />
            </span>
            <span className="sl-memory-card-icon">
              <item.icon size={29} />
            </span>
            <strong>{item.title}</strong>
            <span className="sl-memory-card-note">{item.note}</span>
            {index === 1 && (
              <span className="sl-human-gate-pair">
                <span>Approve test</span>
                <span>Accept evidence</span>
              </span>
            )}
            {index === 3 && (
              <svg
                className="sl-mini-memory-graph"
                viewBox="0 0 150 55"
                aria-hidden="true"
              >
                <path d="M15 29H55L92 11H135M55 29L92 47H135" />
                <circle cx="15" cy="29" r="5" />
                <circle cx="55" cy="29" r="5" />
                <circle cx="92" cy="11" r="5" />
                <circle cx="92" cy="47" r="5" />
                <circle cx="135" cy="11" r="5" />
                <circle cx="135" cy="47" r="5" />
              </svg>
            )}
          </button>
        ))}
      </div>
      <div className="sl-memory-explanation" aria-live="polite">
        <div>
          <span className="sl-memory-explanation-label">
            <current.icon size={16} />
            {current.title}
          </span>
          <p>{current.detail}</p>
        </div>
        <span className="sl-memory-principle">
          <Check size={14} />
          {current.principle}
        </span>
      </div>
      <p className="sl-workbench-caption">
        <CircleHelp size={13} />
        Interactive illustration only. No tests run or workspace records are
        shown.
      </p>
    </div>
  );
}

export function Landing({
  authenticated,
  statusMessage = null,
}: {
  authenticated: (session: Session) => void;
  statusMessage?: string | null;
}) {
  const [signingIn, setSigningIn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [stage, setStage] = useState(0);
  const [system, setSystem] = useState(1);
  const [activeSection, setActiveSection] = useState("");
  const menuToggle = useRef<HTMLButtonElement>(null);
  const current = stages[stage]!;
  const selectedSystem = foundation[system]!;
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) setActiveSection(entry.target.id);
      },
      { rootMargin: "-15% 0px -55% 0px" },
    );
    for (const id of ["product", "workflow", "architecture"]) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuToggle.current?.focus();
      }
    }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [menuOpen]);
  function signIn() {
    setMenuOpen(false);
    setSigningIn(true);
  }
  return (
    <main className="sky-landing" id="arcloom-top">
      <a href="#product" className="sl-skip-link">
        Skip to product information
      </a>
      <header className="sl-header">
        <a href="#arcloom-top" className="sl-brand" aria-label="Arcloom home">
          <BrandMark />
          <span>arcloom</span>
        </a>
        <nav className="sl-desktop-nav" aria-label="Product navigation">
          {["Product", "Workflow", "Architecture"].map((name) => (
            <a
              key={name}
              href={`#${name.toLowerCase()}`}
              aria-current={
                activeSection === name.toLowerCase() ? "location" : undefined
              }
            >
              {name}
            </a>
          ))}
        </nav>
        <div className="sl-header-actions">
          <button type="button" className="sl-sign-in" onClick={signIn}>
            Sign in
            <ArrowUpRight size={16} />
          </button>
          <button
            type="button"
            ref={menuToggle}
            className="sl-icon-button sl-menu-toggle"
            aria-label={menuOpen ? "Close product menu" : "Open product menu"}
            aria-expanded={menuOpen}
            aria-controls="sl-mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        {menuOpen && (
          <nav
            id="sl-mobile-navigation"
            className="sl-mobile-nav"
            aria-label="Mobile product navigation"
          >
            {["Product", "Workflow", "Architecture"].map((name) => (
              <a
                href={`#${name.toLowerCase()}`}
                key={name}
                onClick={() => setMenuOpen(false)}
              >
                {name}
                <ArrowUpRight size={16} />
              </a>
            ))}
          </nav>
        )}
      </header>
      <section className="sl-hero" aria-labelledby="sl-title">
        <div className="sl-hero-cloud sl-cloud-one" aria-hidden="true" />
        <div className="sl-hero-cloud sl-cloud-two" aria-hidden="true" />
        <div className="sl-hero-grid" aria-hidden="true" />
        {statusMessage && (
          <p className="sl-status-message" role="alert">
            <CircleHelp size={16} />
            {statusMessage}
          </p>
        )}
        <div className="sl-hero-copy">
          <p className="sl-eyebrow">
            <span />
            CONNECTED SECURITY INTELLIGENCE
          </p>
          <h1 id="sl-title">
            See the connections.
            <br />
            Build on the evidence.
          </h1>
          <p className="sl-hero-description">
            Turn reviewed findings into shared intelligence.
            <br className="sl-desktop-break" /> Give the next investigation a
            better place to begin.
          </p>
          <div className="sl-hero-actions">
            <button
              type="button"
              className="sl-button sl-button-dark"
              onClick={signIn}
            >
              Open your workspace
              <ArrowUpRight size={19} />
            </button>
            <a className="sl-button sl-button-glass" href="#workflow">
              See how it works
              <ArrowDown size={17} />
            </a>
          </div>
          <p className="sl-hero-note">
            Human-approved. Evidence-backed. Made to connect.
          </p>
        </div>
        <EvidenceWorkbench />
        <div className="sl-hero-bottom">
          <span>
            <ShieldCheck size={15} />
            Controlled synthetic lab
          </span>
          <span>
            <Database size={15} />
            Powered by FalkorDB memory
          </span>
          <a href="#product" aria-label="Explore the product">
            <ArrowDown size={18} />
          </a>
        </div>
      </section>
      <section
        className="sl-product sl-section"
        id="product"
        aria-labelledby="sl-product-title"
      >
        <div className="sl-section-heading">
          <span className="sl-section-tag">A LITTLE MORE CONNECTED</span>
          <h2 id="sl-product-title">
            Make every investigation
            <br />
            count for the next one.
          </h2>
          <p>
            A finding is useful. A finding with evidence, context, and
            connections?
            <br className="sl-desktop-break" /> That’s a much better starting
            point.
          </p>
        </div>
        <div className="sl-feature-grid">
          <article className="sl-feature-card">
            <div className="sl-feature-art sl-evidence-art" aria-hidden="true">
              <span className="sl-paper sl-paper-back" />
              <span className="sl-paper sl-paper-middle" />
              <div className="sl-paper sl-paper-front">
                <Fingerprint size={45} strokeWidth={1.5} />
                <span>Evidence has a source.</span>
                <div className="sl-paper-lines">
                  <i />
                  <i />
                  <i />
                </div>
                <b>
                  <Check size={12} />
                  Signed receipt
                </b>
              </div>
              <span className="sl-blue-orb" />
            </div>
            <p className="sl-feature-index">01 / KEEP THE PROOF</p>
            <h3>
              Evidence you can
              <br />
              stand behind.
            </h3>
            <p>
              Signed receipts, stored bytes, and content hashes keep accepted
              findings tied to the actual evidence and original researcher.
            </p>
          </article>
          <article className="sl-feature-card">
            <div className="sl-feature-art sl-approval-art" aria-hidden="true">
              <div>
                <ShieldCheck size={21} />
                <span>Approve the test</span>
                <ArrowUpRight size={16} />
              </div>
              <span className="sl-approval-connector" />
              <div>
                <Fingerprint size={21} />
                <span>Accept the evidence</span>
                <Check size={15} />
              </div>
              <span className="sl-approval-dot" />
            </div>
            <p className="sl-feature-index">02 / KEEP PEOPLE IN CONTROL</p>
            <h3>
              Human judgment.
              <br />
              Built right in.
            </h3>
            <p>
              An agent can propose the next test. People approve execution and
              separately accept evidence. Two decisions, clearly recorded.
            </p>
          </article>
          <article className="sl-feature-card">
            <div className="sl-feature-art sl-memory-art" aria-hidden="true">
              <span className="sl-memory-sheet sl-memory-sheet-back" />
              <span className="sl-memory-sheet sl-memory-sheet-mid" />
              <span className="sl-memory-sheet sl-memory-sheet-front">
                <Layers3 size={36} />
                <strong>Context carries forward.</strong>
                <span>History stays. Current support is checked.</span>
              </span>
              <span className="sl-memory-spark">
                <Sparkles size={24} />
              </span>
            </div>
            <p className="sl-feature-index">03 / KEEP THE CONTEXT</p>
            <h3>
              A memory that
              <br />
              stays honest.
            </h3>
            <p>
              Earlier findings and negative results remain useful history.
              Current prerequisites are checked against the active deployment
              revision.
            </p>
          </article>
        </div>
      </section>
      <section
        className="sl-workflow sl-section"
        id="workflow"
        aria-labelledby="sl-workflow-title"
      >
        <div className="sl-section-heading">
          <span className="sl-section-tag">
            SMALL STEPS. STRONGER CONNECTIONS.
          </span>
          <h2 id="sl-workflow-title">
            From “we noticed something”
            <br />
            to “here’s what comes next.”
          </h2>
          <p>
            Explore the four stages. Nothing runs here.
            <br className="sl-desktop-break" /> Every real test still needs its
            own human approval.
          </p>
        </div>
        <div
          className="sl-workflow-tabs"
          role="tablist"
          aria-label="Investigation workflow"
        >
          {stages.map((item, index) => (
            <button
              key={item.title}
              type="button"
              role="tab"
              id={`sl-stage-${index}`}
              aria-controls="sl-stage-panel"
              aria-selected={stage === index}
              tabIndex={stage === index ? 0 : -1}
              className={stage === index ? "is-active" : ""}
              onClick={() => setStage(index)}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowRight")
                  next = (index + 1) % stages.length;
                else if (event.key === "ArrowLeft")
                  next = (index + stages.length - 1) % stages.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = stages.length - 1;
                else return;
                event.preventDefault();
                setStage(next);
                document.getElementById(`sl-stage-${next}`)?.focus();
              }}
            >
              <span>0{index + 1}</span> <item.icon size={18} />{" "}
              <strong>{item.title}</strong>
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
        <div
          className="sl-workflow-panel"
          role="tabpanel"
          id="sl-stage-panel"
          aria-labelledby={`sl-stage-${stage}`}
          tabIndex={0}
        >
          <div className="sl-workflow-copy" aria-live="polite">
            <p className="sl-eyebrow">
              STAGE 0{stage + 1} / {current.title.toUpperCase()}
            </p>
            <h3>{current.heading}</h3>
            <p>{current.body}</p>
            <dl>
              <div>
                <dt>Checkpoint</dt>
                <dd>{current.checkpoint}</dd>
              </div>
              <div>
                <dt>What follows</dt>
                <dd>{current.outcome}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="sl-text-button"
              onClick={() => setStage((value) => (value + 1) % stages.length)}
            >
              {stage === 3 ? "Back to the beginning" : "See the next stage"}
              <ArrowRight size={17} />
            </button>
          </div>
          <div className="sl-workflow-art" aria-hidden="true">
            <span className="sl-workflow-art-label">
              ILLUSTRATIVE WORKFLOW · NOT WORKSPACE DATA
            </span>
            <span className="sl-workflow-sheet sl-workflow-sheet-back" />
            <div className="sl-workflow-sheet sl-workflow-sheet-front">
              <span className="sl-workflow-sheet-icon">
                <current.icon size={29} />
              </span>
              <h4>{current.sheetTitle}</h4>
              <ul>
                {current.items.map((item) => (
                  <li key={item}>
                    <Check size={15} />
                    {item}
                  </li>
                ))}
              </ul>
              <p>{current.sheetNote}</p>
            </div>
            <span className="sl-workflow-art-star" aria-hidden="true">
              <Sparkles size={30} />
            </span>
          </div>
        </div>
      </section>
      <section
        className="sl-foundation sl-section"
        id="architecture"
        aria-labelledby="sl-foundation-title"
      >
        <div className="sl-foundation-heading">
          <div>
            <span className="sl-section-tag">
              GOOD CONNECTIONS NEED SOLID GROUND
            </span>
            <h2 id="sl-foundation-title">
              Bright ideas.
              <br />
              Serious foundations.
            </h2>
          </div>
          <p>
            Behind the friendly surface, every record has a responsibility.
            Explore what keeps the investigation grounded.
          </p>
        </div>
        <div className="sl-foundation-layout">
          <div
            className="sl-foundation-options"
            role="group"
            aria-label="Explore the system architecture"
          >
            {foundation.map((item, index) => (
              <button
                key={item.name}
                type="button"
                aria-label={`Inspect ${item.name}`}
                aria-pressed={system === index}
                className={system === index ? "is-active" : ""}
                onClick={() => setSystem(index)}
              >
                <span>
                  <item.icon size={22} />
                </span>
                <strong>{item.name}</strong>
                <ArrowUpRight size={18} />
              </button>
            ))}
          </div>
          <div className="sl-foundation-detail" aria-live="polite">
            <span className="sl-foundation-detail-icon">
              <selectedSystem.icon size={31} />
            </span>
            <h3>{selectedSystem.title}</h3>
            <p>{selectedSystem.copy}</p>
            <div>
              {selectedSystem.tags.map((tag) => (
                <span key={tag}>
                  <Check size={12} />
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="sl-foundation-note">
          <LockKeyhole size={18} />
          <p>
            When graph memory is unavailable, discovery fails closed. No
            invented prerequisites. No silent fallback.
          </p>
          <a
            href="https://github.com/MokiMeow/arcloom/blob/main/docs/architecture.md"
            target="_blank"
            rel="noreferrer"
          >
            Read the architecture
            <ArrowUpRight size={15} />
          </a>
        </div>
      </section>
      <section
        className="sl-faq sl-section"
        id="questions"
        aria-labelledby="sl-faq-title"
      >
        <div>
          <span className="sl-section-tag">GOOD QUESTIONS</span>
          <h2 id="sl-faq-title">
            A few things
            <br />
            worth knowing.
          </h2>
          <p>
            The workspace, the agents,
            <br />
            and the boundaries between them.
          </p>
        </div>
        <div className="sl-faq-list">
          {questions.map(([question, answer]) => (
            <details key={question}>
              <summary>
                {question}
                <ChevronDown size={19} />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <section className="sl-final-cta" aria-labelledby="sl-final-title">
        <div className="sl-final-cloud" aria-hidden="true" />
        <span className="sl-final-spark" aria-hidden="true">
          <Sparkles size={45} strokeWidth={1.5} />
        </span>
        <span className="sl-section-tag">
          PICK UP WITH A BETTER PERSPECTIVE
        </span>
        <h2 id="sl-final-title">
          Put your knowledge
          <br />
          to work.
        </h2>
        <p>The next investigation starts with what you can verify.</p>
        <button
          type="button"
          className="sl-button sl-button-dark"
          onClick={signIn}
        >
          Sign in to your workspace
          <ArrowUpRight size={19} />
        </button>
        <span className="sl-final-note">
          <ShieldCheck size={15} />
          Controlled lab. Deterministic by default.
        </span>
      </section>
      <footer className="sl-footer">
        <div>
          <a href="#arcloom-top" className="sl-brand" aria-label="Arcloom home">
            <BrandMark />
            <span>arcloom</span>
          </a>
          <p>Evidence. Context. A better next question.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <a href="#architecture">Architecture</a>
          <a
            href="https://github.com/MokiMeow/arcloom"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
            <ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="sl-footer-bottom">
          <span>Graph-native security intelligence</span>
          <span>Human-approved. Evidence-backed.</span>
          <a href="#arcloom-top">
            Back to top
            <ArrowUpRight size={14} />
          </a>
        </div>
      </footer>
      {signingIn && (
        <AccountAccess
          authenticated={authenticated}
          close={() => setSigningIn(false)}
        />
      )}
    </main>
  );
}
