// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderSettings } from "./ProviderSettings";
import type { Dashboard, ProviderStatus } from "../types";

const model: Dashboard["model"] = {
  provider: "openai",
  model: "model-one",
  live_llm: true,
  input_tokens: 4,
  output_tokens: 2,
  sessions: 0,
};
const status: ProviderStatus = {
  active_provider: "openai",
  available_providers: [
    "deterministic",
    "openai",
    "gemini",
    "cloudflare",
    "chatgpt",
    "anthropic",
  ].map((id) => ({ id, label: id })),
  providers: [
    {
      id: "deterministic",
      label: "Deterministic",
      model: "policy",
      key_configured: false,
      account_id: "",
      connected: true,
    },
    {
      id: "openai",
      label: "OpenAI API",
      model: "model-one",
      key_configured: true,
      account_id: "",
      connected: true,
    },
    {
      id: "gemini",
      label: "Gemini",
      model: "gemini-model",
      key_configured: false,
      account_id: "",
      connected: false,
    },
    {
      id: "cloudflare",
      label: "Cloudflare",
      model: "cf-model",
      key_configured: false,
      account_id: "account-one",
      connected: false,
    },
    {
      id: "chatgpt",
      label: "ChatGPT subscription",
      model: "chatgpt-model",
      key_configured: false,
      account_id: "",
      connected: false,
    },
    {
      id: "anthropic",
      label: "Anthropic",
      model: "claude-model",
      key_configured: false,
      account_id: "",
      connected: false,
    },
  ].map((provider) => ({ ...provider, profile_id: "" })),
  chatgpt: {
    connected: false,
    active_profile_id: null,
    profiles: [],
    pending: false,
  },
};

function setup(
  overrides?: (
    path: string,
    options?: RequestInit,
  ) => Response | Promise<Response> | undefined,
) {
  const fetcher = vi.fn(
    async (path: string, options?: RequestInit) =>
      overrides?.(path, options) ?? Response.json(status),
  );
  vi.stubGlobal("fetch", fetcher);
  const changed = vi.fn();
  const view = render(
    <ProviderSettings
      model={model}
      revision={0}
      role="admin"
      changed={changed}
    />,
  );
  return { fetcher, changed, ...view };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("provider setup", () => {
  it("keeps non-admin metadata read only without provider requests", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(
      <ProviderSettings
        model={model}
        revision={0}
        role="viewer"
        changed={vi.fn()}
      />,
    );
    expect(screen.getByText("model-one")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save provider" }),
    ).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("preserves a provider's saved key by omitting a blank secret and refreshes the dashboard", async () => {
    const { fetcher, changed } = setup();
    await screen.findByLabelText("API key");
    expect(screen.getByLabelText("API key")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.getByText(/Key configured/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    const post = fetcher.mock.calls.find(
      ([, options]) => options?.method === "POST",
    );
    expect(post?.[0]).toBe("/api/providers");
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      provider: "openai",
      model: "model-one",
    });
    expect(screen.getByLabelText("API key")).toHaveValue("");
  });

  it("clears an unsaved secret on provider changes and after saving", async () => {
    const { fetcher } = setup();
    await screen.findByLabelText("API key");
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "private-fixture" },
    });
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "gemini" },
    });
    expect(screen.getByLabelText("API key")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "new-fixture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
    await waitFor(() =>
      expect(screen.getByLabelText("API key")).toHaveValue(""),
    );
    const post = fetcher.mock.calls.find(
      ([, options]) => options?.method === "POST",
    );
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      provider: "gemini",
      model: "gemini-model",
      api_key: "new-fixture",
    });
    expect(screen.queryByText("new-fixture")).not.toBeInTheDocument();
  });

  it("only tests on an explicit click and shows diagnostic usage without claiming a finding", async () => {
    const { fetcher } = setup((path, options) =>
      path === "/api/providers/test" && options?.method === "POST"
        ? Response.json({
            status: "needs_review",
            provider: "openai",
            model: "model-one",
            input_tokens: 15,
            output_tokens: 7,
            reason: "Model declined the fixture.",
          })
        : undefined,
    );
    await screen.findByLabelText("API key");
    expect(
      fetcher.mock.calls.every(([path]) => path !== "/api/providers/test"),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText("Model declined the fixture."),
    ).toBeVisible();
    expect(screen.getByText(/15 input · 7 output tokens/)).toBeVisible();
    expect(screen.getByText(/Diagnostic only/)).toBeVisible();
  });

  it("shows helpful request failures and never echoes the entered secret", async () => {
    setup((path, options) =>
      path === "/api/providers" && options?.method === "POST"
        ? Response.json(
            {
              error: {
                message:
                  "The provider rejected the key. Check its permissions.",
              },
            },
            { status: 400 },
          )
        : undefined,
    );
    await screen.findByLabelText("API key");
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "private-fixture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Check its permissions/,
    );
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.queryByText("private-fixture")).not.toBeInTheDocument();
  });

  it("offers an authorization link when a popup is blocked, polls only while pending, and cancels on unmount", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { fetcher, unmount } = setup((path) =>
      path === "/api/providers/chatgpt/start"
        ? Response.json({
            authorization_url: "https://auth.openai.com/authorize?fixture=1",
            expires_at: Date.now() / 1000 + 300,
          })
        : undefined,
    );
    await screen.findByLabelText("Provider");
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "chatgpt" },
    });
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByRole("link", { name: "Open ChatGPT sign-in" }),
    ).toHaveAttribute("href", "https://auth.openai.com/authorize?fixture=1");
    const before = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher.mock.calls.length).toBeGreaterThan(before);
    unmount();
    const after = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetcher.mock.calls.length).toBe(after);
  });

  it("keeps ChatGPT selected after connection and saves the selected account and catalog model", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    let connected = false;
    const connectedStatus = {
      ...status,
      chatgpt: {
        connected: true,
        pending: false,
        active_profile_id: "profile-one",
        profiles: [
          {
            id: "profile-one",
            email: "judge@example.test",
            label: "Judge",
            connected: true,
          },
          {
            id: "profile-two",
            email: "second@example.test",
            label: "Second",
            connected: true,
          },
        ],
      },
    };
    const { fetcher } = setup((path) => {
      if (path === "/api/providers/chatgpt/start")
        return Response.json({
          authorization_url: "https://auth.openai.com/authorize",
          expires_at: Date.now() / 1000 + 300,
        });
      if (path.startsWith("/api/providers/chatgpt/models"))
        return Response.json({
          items: path.endsWith("profile-two")
            ? [{ id: "second-model", name: "Second account model" }]
            : [{ id: "catalog-model", name: "Catalog model" }],
        });
      if (path === "/api/providers" && connected)
        return Response.json(connectedStatus);
    });
    await screen.findByLabelText("Provider");
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "chatgpt" },
    });
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    connected = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    vi.useRealTimers();
    expect(screen.getByLabelText("Provider")).toHaveValue("chatgpt");
    await screen.findByRole("option", { name: "Catalog model" });
    expect(screen.getByText(/Connected as judge@example.test/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("ChatGPT account"), {
      target: { value: "profile-two" },
    });
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([path]) =>
            path === "/api/providers/chatgpt/models?profile_id=profile-two",
        ),
      ).toBe(true),
    );
    await screen.findByRole("option", { name: "Second account model" });
    expect(
      screen.queryByRole("option", { name: "Catalog model" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save provider" }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([path, options]) =>
            path === "/api/providers" && options?.method === "POST",
        ),
      ).toBe(true),
    );
    const post = fetcher.mock.calls.find(
      ([path, options]) =>
        path === "/api/providers" && options?.method === "POST",
    );
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      provider: "chatgpt",
      model: "second-model",
      profile_id: "profile-two",
    });
  });

  it("bounds pending sign-in polling to five minutes and stops on provider change", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    const { fetcher } = setup((path) =>
      path === "/api/providers/chatgpt/start"
        ? Response.json({
            authorization_url: "https://auth.openai.com/authorize",
            expires_at: Date.now() / 1000 + 300,
          })
        : undefined,
    );
    await screen.findByLabelText("Provider");
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "chatgpt" },
    });
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300000);
    });
    expect(screen.getByText(/ChatGPT sign-in timed out/)).toBeVisible();
    const timedOut = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetcher.mock.calls.length).toBe(timedOut);
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    await act(async () => {
      await Promise.resolve();
    });
    const switched = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetcher.mock.calls.length).toBe(switched);
  });

  it("loads the selected connected account's models even when the active account is disconnected", async () => {
    const accountStatus = {
      ...status,
      active_provider: "chatgpt",
      chatgpt: {
        connected: false,
        pending: false,
        active_profile_id: "inactive-account",
        profiles: [
          {
            id: "inactive-account",
            email: "old@example.test",
            label: "Old",
            connected: false,
          },
          {
            id: "connected-account",
            email: "connected@example.test",
            label: "Connected",
            connected: true,
          },
        ],
      },
    };
    const { fetcher } = setup((path) => {
      if (path === "/api/providers") return Response.json(accountStatus);
      if (path === "/api/providers/chatgpt/models?profile_id=connected-account")
        return Response.json({
          items: [{ id: "connected-model", name: "Connected model" }],
        });
    });
    await screen.findByLabelText("ChatGPT account");
    expect(fetcher.mock.calls.some(([path]) => path.includes("/models"))).toBe(
      false,
    );
    expect(
      screen.getByRole("button", { name: "Save provider" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("ChatGPT account"), {
      target: { value: "connected-account" },
    });
    await screen.findByRole("option", { name: "Connected model" });
    expect(screen.getByLabelText("ChatGPT model")).toHaveValue(
      "connected-model",
    );
    expect(screen.getByRole("button", { name: "Save provider" })).toBeEnabled();
  });

  it("reports an OAuth start failure and restores the sign-in action", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    setup((path) =>
      path === "/api/providers/chatgpt/start"
        ? Response.json(
            { error: { message: "Sign-in service unavailable. Try again." } },
            { status: 503 },
          )
        : undefined,
    );
    await screen.findByLabelText("Provider");
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "chatgpt" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Sign-in service unavailable/,
    );
    expect(
      screen.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("link", { name: "Open ChatGPT sign-in" }),
    ).not.toBeInTheDocument();
  });

  it("shows a sanitized callback failure and stops pending sign-in polling", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    let failed = false;
    const { fetcher } = setup((path) => {
      if (path === "/api/providers/chatgpt/start")
        return Response.json({
          authorization_url: "https://auth.openai.com/authorize",
          expires_at: Date.now() / 1000 + 300,
        });
      if (path === "/api/providers" && failed)
        return Response.json({
          ...status,
          chatgpt: {
            ...status.chatgpt,
            last_error: "ChatGPT sign-in could not be verified. Try again.",
          },
        });
    });
    await screen.findByLabelText("Provider");
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "chatgpt" },
    });
    vi.useFakeTimers();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with ChatGPT" }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    failed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /sign-in could not be verified/,
    );
    expect(
      screen.getByRole("button", { name: "Continue with ChatGPT" }),
    ).toBeEnabled();
    const stopped = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetcher.mock.calls.length).toBe(stopped);
  });

  it("keeps the configured billing account separate from the most recent OAuth sign-in", async () => {
    const accountStatus = {
      ...status,
      active_provider: "chatgpt",
      providers: status.providers.map((p) =>
        p.id === "chatgpt"
          ? {
              ...p,
              profile_id: "configured-a",
              connected: true,
              model: "shared-model",
            }
          : p,
      ),
      chatgpt: {
        connected: true,
        pending: false,
        active_profile_id: "signed-in-b",
        profiles: [
          {
            id: "configured-a",
            email: "configured-a@example.test",
            label: "A",
            connected: true,
          },
          {
            id: "signed-in-b",
            email: "signed-in-b@example.test",
            label: "B",
            connected: true,
          },
        ],
      },
    };
    const { fetcher } = setup((path) => {
      if (path === "/api/providers") return Response.json(accountStatus);
      if (path.startsWith("/api/providers/chatgpt/models"))
        return Response.json({
          items: [{ id: "shared-model", name: "Shared model" }],
        });
    });
    await screen.findByRole("option", { name: "Shared model" });
    expect(screen.getByLabelText("ChatGPT account")).toHaveValue(
      "configured-a",
    );
    expect(
      screen.getByText(/Configured planner account: configured-a@example.test/),
    ).toBeVisible();
    expect(
      screen.getByText(/Most recent ChatGPT sign-in: signed-in-b@example.test/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeEnabled();
    expect(
      fetcher.mock.calls.some(
        ([path]) =>
          path === "/api/providers/chatgpt/models?profile_id=configured-a",
      ),
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("ChatGPT account"), {
      target: { value: "signed-in-b" },
    });
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([path]) =>
            path === "/api/providers/chatgpt/models?profile_id=signed-in-b",
        ),
      ).toBe(true),
    );
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/Configured planner account: configured-a@example.test/),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "openai" },
    });
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "chatgpt" },
    });
    expect(screen.getByLabelText("ChatGPT account")).toHaveValue(
      "configured-a",
    );
  });
});
