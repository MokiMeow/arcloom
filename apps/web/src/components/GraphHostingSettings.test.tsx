// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphHostingSettings } from "./GraphHostingSettings";

const status = {
  current: {
    host: "127.0.0.1",
    port: 6380,
    username: "",
    ssl: false,
    prefix: "local_lab",
  },
  target: {
    host: "cloud.example.test",
    port: 13855,
    username: "falkordb",
    ssl: false,
    password_configured: true,
  },
  staged: true,
};
function setup(fail = false, response = status) {
  const fetcher = vi.fn(async (_path: string, options?: RequestInit) =>
    options?.method === "POST" && fail
      ? Response.json(
          {
            error: {
              message:
                "Target could not be saved. Check the connection fields.",
            },
          },
          { status: 400 },
        )
      : Response.json(response),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<GraphHostingSettings revision={0} role="admin" />);
  return fetcher;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cloud graph connection", () => {
  it("does not render or request credentials for non-admins", () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<GraphHostingSettings revision={0} role="viewer" />);
    expect(screen.queryByLabelText("Cloud password")).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("distinguishes the active local graph from the staged cloud target without prefilling a password", async () => {
    const fetcher = setup();
    await screen.findByLabelText("Cloud endpoint (host)");
    expect(screen.getByText("127.0.0.1:6380")).toBeVisible();
    expect(screen.getByText("cloud.example.test:13855")).toBeVisible();
    expect(screen.getByLabelText("Cloud password")).toHaveValue("");
    expect(screen.getByLabelText("Cloud password")).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.getByText(/Password configured/)).toBeVisible();
    expect(screen.getByText(/Existing local data remains/)).toBeVisible();
    expect(
      screen.getByText("Connection staged; migration is separate"),
    ).toBeVisible();
    expect(fetcher.mock.calls).toHaveLength(1);
  });

  it("identifies when the cloud target is configured as the current graph server", async () => {
    setup(false, {
      ...status,
      current: { ...status.target, prefix: "cloud_lab" },
    });
    expect(
      await screen.findByText(
        "Cloud target is configured as the current graph server",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("Connection staged; migration is separate"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Cloud username")).toHaveAttribute(
      "maxlength",
      "100",
    );
  });

  it.each([
    { host: "different.example.test" },
    { port: 13856 },
    { username: "different-user" },
    { ssl: true },
  ])(
    "keeps a target staged when any connection field differs: %j",
    async (difference) => {
      setup(false, {
        ...status,
        current: { ...status.target, prefix: "cloud_lab", ...difference },
      });
      expect(
        await screen.findByText("Connection staged; migration is separate"),
      ).toBeVisible();
      expect(
        screen.queryByText(
          "Cloud target is configured as the current graph server",
        ),
      ).not.toBeInTheDocument();
    },
  );

  it("preserves the same target's password by omitting a blank password and does not migrate", async () => {
    const fetcher = setup();
    await screen.findByLabelText("Cloud endpoint (host)");
    fireEvent.click(
      screen.getByRole("button", { name: "Save cloud connection" }),
    );
    await screen.findByText(/Cloud connection staged/);
    const post = fetcher.mock.calls.find(
      ([, options]) => options?.method === "POST",
    );
    expect(post?.[0]).toBe("/api/graph-hosting/target");
    expect(JSON.parse(post?.[1]?.body as string)).toEqual({
      host: "cloud.example.test",
      port: 13855,
      username: "falkordb",
      ssl: false,
    });
    expect(
      fetcher.mock.calls.every(
        ([path]) =>
          path === "/api/graph-hosting" || path === "/api/graph-hosting/target",
      ),
    ).toBe(true);
  });

  it("requires a new password for a different host, port, or username", async () => {
    const fetcher = setup();
    await screen.findByLabelText("Cloud endpoint (host)");
    fireEvent.change(screen.getByLabelText("Cloud endpoint (host)"), {
      target: { value: "different.example.test" },
    });
    expect(screen.getByLabelText("Cloud password")).toBeRequired();
    fireEvent.submit(
      screen.getByRole("form", { name: "Cloud graph connection" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Enter a password for this target/,
    );
    expect(
      fetcher.mock.calls.some(([, options]) => options?.method === "POST"),
    ).toBe(false);
    fireEvent.change(screen.getByLabelText("Cloud endpoint (host)"), {
      target: { value: "cloud.example.test" },
    });
    fireEvent.change(screen.getByLabelText("Cloud port"), {
      target: { value: "13856" },
    });
    expect(screen.getByLabelText("Cloud password")).toBeRequired();
    fireEvent.change(screen.getByLabelText("Cloud port"), {
      target: { value: "13855" },
    });
    fireEvent.change(screen.getByLabelText("Cloud username"), {
      target: { value: "another-user" },
    });
    expect(screen.getByLabelText("Cloud password")).toBeRequired();
  });

  it.each([false, true])(
    "clears a submitted password on success or failure (failure=%s)",
    async (fail) => {
      const fetcher = setup(fail);
      await screen.findByLabelText("Cloud password");
      fireEvent.change(screen.getByLabelText("Cloud password"), {
        target: { value: "private-graph-fixture" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Save cloud connection" }),
      );
      await waitFor(() =>
        expect(screen.getByLabelText("Cloud password")).toHaveValue(""),
      );
      const post = fetcher.mock.calls.find(
        ([, options]) => options?.method === "POST",
      );
      expect(JSON.parse(post?.[1]?.body as string).password).toBe(
        "private-graph-fixture",
      );
      expect(
        screen.queryByText("private-graph-fixture"),
      ).not.toBeInTheDocument();
      if (fail)
        expect(screen.getByRole("alert")).toHaveTextContent(
          /Check the connection fields/,
        );
    },
  );
});
