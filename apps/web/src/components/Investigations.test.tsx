// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Investigations } from "./Investigations";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("investigation permissions", () => {
  it("keeps report submission out of the viewer inbox", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    render(
      <Investigations
        revision={0}
        openCase={() => {}}
        newReport={() => {}}
        canWrite={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Submit report" }),
    ).not.toBeInTheDocument();
  });

  it("lets an authorized researcher start a report", () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));
    const newReport = vi.fn();
    render(
      <Investigations
        revision={0}
        openCase={() => {}}
        newReport={newReport}
        canWrite
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));
    expect(newReport).toHaveBeenCalledOnce();
  });
});

const records = [
  {
    id: "case_gateway",
    title: "Gateway observation",
    asset_id: "gateway-api",
    test_id: "gateway-boundary",
    researcher: "Research team",
    origin: "report",
    revision: "r1",
    state: "confirmed",
    stale: true,
    updated_at: 1793000000,
  },
  {
    id: "case_invoice",
    title: "Invoice observation",
    asset_id: "invoice-api",
    test_id: "invoice-tenant-boundary",
    researcher: "Agent team",
    origin: "agent",
    revision: "r2",
    state: "awaiting_review",
    stale: false,
    updated_at: 1793000100,
  },
];
function listResponse(items = records, total = items.length) {
  return Response.json({ items, total, limit: 20, offset: 0 });
}
function renderInbox() {
  const openCase = vi.fn();
  const result = render(
    <Investigations
      revision={0}
      openCase={openCase}
      newReport={() => {}}
      canWrite={false}
    />,
  );
  return { ...result, openCase };
}

describe("investigation inbox", () => {
  it("filters with status chips using API state and labels counts as loaded-page counts", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(listResponse(records, 41)));
    vi.stubGlobal("fetch", fetch);
    renderInbox();
    await screen.findByText("41 investigations in this workspace");
    const group = screen.getByRole("group", {
      name: "Filter investigation status",
    });
    expect(group).toHaveAccessibleDescription(
      "Chip counts and sorting describe the loaded page.",
    );
    const confirmed = within(group).getByRole("button", { name: /Confirmed/ });
    expect(confirmed).toHaveTextContent("1");
    expect(
      within(group).getByRole("button", { name: /All states/ }),
    ).toHaveTextContent("2");
    fireEvent.click(confirmed);
    await waitFor(() =>
      expect(fetch.mock.calls.at(-1)?.[0]).toContain("state=confirmed"),
    );
    expect(
      screen.getByRole("combobox", { name: "Filter by status" }),
    ).toHaveValue("confirmed");
    expect(confirmed).toHaveAttribute("aria-pressed", "true");
  });

  it("clears search independently from status and resets all filters", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(listResponse([])));
    vi.stubGlobal("fetch", fetch);
    renderInbox();
    await screen.findByText("No investigations yet");
    const search = screen.getByRole("textbox", {
      name: "Search investigations",
    });
    const status = screen.getByRole("combobox", { name: "Filter by status" });
    fireEvent.change(status, { target: { value: "awaiting_review" } });
    fireEvent.change(search, { target: { value: "case_gateway" } });
    await screen.findByText("No matching investigations");
    await waitFor(() =>
      expect(fetch.mock.calls.at(-1)?.[0]).toContain("q=case_gateway"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(search).toHaveValue("");
    expect(status).toHaveValue("awaiting_review");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(status).toHaveValue("");
    await screen.findByText("No investigations yet");
  });

  it("keeps actual status and provenance in desktop rows and full mobile cards", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() => Promise.resolve(listResponse([records[0]]))),
    );
    const { container, openCase } = renderInbox();
    await screen.findByText("1 investigation in this workspace");
    for (const selector of [
      ".investigations-desktop",
      ".investigations-mobile",
    ]) {
      const region = container.querySelector<HTMLElement>(selector)!;
      expect(
        within(region).getByText("Confirmed · historical"),
      ).toBeInTheDocument();
      for (const text of [
        "case_gateway",
        "gateway-api",
        "gateway-boundary",
        "Research team",
        "r1",
      ])
        expect(region).toHaveTextContent(text);
      fireEvent.click(
        within(region).getByRole("button", { name: "Gateway observation" }),
      );
    }
    expect(openCase).toHaveBeenCalledTimes(2);
    expect(openCase).toHaveBeenLastCalledWith("case_gateway");
  });

  it("sorts only loaded records and communicates column direction", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(listResponse())),
    );
    renderInbox();
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(
      "Invoice observation",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Sort loaded investigations by title",
      }),
    );
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(
      "Gateway observation",
    );
    expect(
      screen.getByRole("columnheader", {
        name: "Investigation",
      }),
    ).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Sort loaded investigations by title",
      }),
    );
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent(
      "Invoice observation",
    );
    expect(
      screen.getByRole("columnheader", {
        name: "Investigation",
      }),
    ).toHaveAttribute("aria-sort", "descending");
  });

  it("distinguishes failures from empty results and retries the request", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { message: "Request unavailable", code: "unavailable" } },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(listResponse([]));
    vi.stubGlobal("fetch", fetch);
    renderInbox();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Request unavailable",
    );
    expect(
      screen.getByText("Investigations could not be loaded"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No matching investigations"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry investigations" }),
    );
    await screen.findByText("No investigations yet");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
