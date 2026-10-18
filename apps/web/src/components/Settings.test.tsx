// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
