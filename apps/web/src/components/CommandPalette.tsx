import { useEffect, useId, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Database,
  GitBranch,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  X,
} from "lucide-react";
import type { View } from "../navigation";

const destinations = [
  {
    view: "overview",
    label: "Overview",
    keywords: "dashboard home",
    icon: LayoutDashboard,
  },
  {
    view: "investigations",
    label: "Investigations",
    keywords: "reports cases approval review",
    icon: GitBranch,
  },
  {
    view: "memory",
    label: "Memory graph",
    keywords: "findings evidence relationships",
    icon: Database,
  },
  {
    view: "activity",
    label: "Activity & evidence",
    keywords: "audit history events",
    icon: Activity,
  },
  {
    view: "settings",
    label: "Workspace policy",
    keywords: "settings team providers graph configuration",
    icon: Settings2,
  },
] as const;

export function CommandPalette({
  onNavigate,
  onNewReport,
  canWrite,
  onClose,
}: {
  onNavigate: (view: View) => void;
  onNewReport: () => void;
  canWrite: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const commands = [
    ...destinations.map((destination) => ({
      id: destination.view,
      label: destination.label,
      keywords: destination.keywords,
      icon: destination.icon,
      run: () => onNavigate(destination.view),
    })),
    ...(canWrite
      ? [
          {
            id: "new-report",
            label: "New report",
            keywords: "create submit observation",
            icon: Plus,
            run: onNewReport,
          },
        ]
      : []),
  ].filter((command) =>
    `${command.label} ${command.keywords}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const selected = Math.min(active, Math.max(0, commands.length - 1));

  useEffect(() => {
    const previous = document.activeElement;
    if (!dialog.current?.open) dialog.current?.showModal();
    input.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);
  useEffect(() => {
    dialog.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected, query]);
  function choose(index: number) {
    const command = commands[index];
    if (!command) return;
    onClose();
    command.run();
  }
  return (
    <dialog
      ref={dialog}
      className="modal command-palette"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key === "Tab") {
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'input, button:not([tabindex="-1"])',
            ),
          ];
          const first = controls[0];
          const last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header className="modal-head">
        <h2 id={`${id}-title`}>Workspace commands</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Close command menu"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </header>
      <div className="command-search">
        <Search size={18} aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-label="Search workspace commands"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-commands`}
          aria-activedescendant={
            commands.length ? `${id}-${commands[selected].id}` : undefined
          }
          placeholder="Search pages and actions…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (commands.length)
                setActive(
                  (selected +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    commands.length) %
                    commands.length,
                );
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(selected);
            }
          }}
        />
        <kbd className="command-key">esc</kbd>
      </div>
      <div
        id={`${id}-commands`}
        className="command-list"
        role="listbox"
        aria-label="Workspace commands"
      >
        {commands.map((command, index) => (
          <button
            key={command.id}
            id={`${id}-${command.id}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={index === selected}
            className={`command-item${index === selected ? " active" : ""}`}
            onPointerMove={() => setActive(index)}
            onClick={() => choose(index)}
          >
            <command.icon size={18} aria-hidden="true" />
            <span>{command.label}</span>
            <ArrowUpRight size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
      {!commands.length && (
        <p className="command-empty" role="status">
          No commands match “{query}”. Try a page name or clear the search.
        </p>
      )}
      <footer className="command-help">
        <span>
          <kbd className="command-key">↑ ↓</kbd> Navigate
        </span>
        <span>
          <kbd className="command-key">↵</kbd> Open
        </span>
        <span>
          <kbd className="command-key">esc</kbd> Close
        </span>
      </footer>
    </dialog>
  );
}
