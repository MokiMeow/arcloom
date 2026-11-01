// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings";
import type { Dashboard } from "../types";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
});

const dashboard: Dashboard = {
  workspace: "Lab",
  revision: "r1",
  revision_title: "Original",
  scope_enabled: true,
  scope_expires_at: 9999999999,
  counts: {},
  findings: [],
  verified_current: 0,
  verified_historical: 0,
  memory: {
    engine: "FalkorDB",
    available: true,
    pending_events: 0,
    in_sync: true,
  },
  budget: {
    executions: 0,
    execution_limit: 40,
    model_calls: 0,
    model_call_limit: 40,
  },
  model: {
    provider: "deterministic",
    model: "policy",
    live_llm: false,
    input_tokens: 0,
    output_tokens: 0,
    sessions: 0,
  },
  worker: { enabled: true, last_tick: null, last_error: null },
  synthetic: true,
  at: 0,
};

async function createMember() {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation((_path: string, options?: RequestInit) =>
        Promise.resolve(
          Response.json(
            options?.method === "POST"
              ? { token: "fixture-member-token" }
              : { items: [] },
          ),
        ),
      ),
  );
  render(
    <Settings
      dashboard={dashboard}
      revision={0}
      changed={() => {}}
      role="admin"
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Member name" }), {
    target: { value: "Researcher" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create access token" }));
  await screen.findByText("fixture-member-token");
}

describe("member token clipboard", () => {
  it("offers manual copying when the Clipboard API is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    await createMember();
    fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /copy the token manually/,
    );
    expect(screen.getByText("fixture-member-token")).toBeVisible();
  });

  it("offers manual copying when clipboard permission is rejected", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Permission denied")),
      },
    });
    await createMember();
    fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /copy the token manually/,
    );
  });
});

describe("workspace policy sections", () => {
  it("offers personal account settings without granting token or workspace administration", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(
      <Settings
        dashboard={dashboard}
        revision={0}
        changed={() => {}}
        role="viewer"
        session={{
          actor: {
            id: "account_viewer",
            tenant: "private_workspace",
            role: "viewer",
            name: "Casey",
            email: "casey@example.com",
            password_account: true,
          },
          csrf: "session-csrf",
        }}
        onSessionUpdated={vi.fn()}
      />,
    );
    const navigation = screen.getByRole("navigation", {
      name: "Workspace policy sections",
    });
    expect(
      within(navigation).getByRole("link", { name: "Account & sign-in" }),
    ).toHaveAttribute("href", "#settings-account");
    expect(
      screen.getByRole("heading", { name: "Account & sign-in" }),
    ).toBeVisible();
    expect(screen.getByText("casey@example.com")).toBeVisible();
    expect(document.getElementById("settings-team")).toBeNull();
    expect(document.getElementById("settings-graph")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create access token" }),
    ).toBeNull();
  });
  it("only links to sections available for the current role", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(
      <Settings
        dashboard={dashboard}
        revision={0}
        changed={() => {}}
        role="viewer"
      />,
    );
    const navigation = screen.getByRole("navigation", {
      name: "Workspace policy sections",
    });
    const links = within(navigation).getAllByRole("link");
    expect(links).toHaveLength(3);
    for (const link of links)
      expect(document.querySelector(link.getAttribute("href")!)).not.toBeNull();
    expect(
      within(navigation).queryByRole("link", { name: "Graph hosting" }),
    ).not.toBeInTheDocument();
    expect(
      within(navigation).queryByRole("link", { name: "Team access" }),
    ).not.toBeInTheDocument();
    expect(document.getElementById("settings-team")).toBeNull();
    expect(document.getElementById("settings-graph")).toBeNull();
  });
  it("focuses and scrolls to a section without replacing the workspace hash route", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const originalHash = window.location.hash;
    window.location.hash = "#/settings";
    render(
      <Settings
        dashboard={dashboard}
        revision={0}
        changed={() => {}}
        role="admin"
      />,
    );
    const navigation = screen.getByRole("navigation", {
      name: "Workspace policy sections",
    });
    expect(within(navigation).getAllByRole("link")).toHaveLength(5);
    const team = document.getElementById("settings-team")!;
    const scroll = vi.fn();
    team.scrollIntoView = scroll;
    fireEvent.click(
      within(navigation).getByRole("link", { name: "Team access" }),
    );
    expect(team).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: "start" });
    expect(window.location.hash).toBe("#/settings");
    window.location.hash = originalHash;
  });
  it("derives expiry from the dashboard timestamp rather than the browser clock", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const properties = {
      revision: 0,
      changed: () => {},
      role: "viewer" as const,
    };
    const { rerender } = render(
      <Settings
        {...properties}
        dashboard={{ ...dashboard, scope_expires_at: 100, at: 50 }}
      />,
    );
    expect(screen.getByText("Admission open")).toBeInTheDocument();
    rerender(
      <Settings
        {...properties}
        dashboard={{ ...dashboard, scope_expires_at: 100, at: 101 }}
      />,
    );
    expect(
      screen.getByText("Assessment expired · new execution blocked"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Admission open")).not.toBeInTheDocument();
  });
});
