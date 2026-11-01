import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const token = "arcloom-e2e-only-" + "t".repeat(48);
// Read-only interface checks share a cookie session only in worker memory.
// Authentication/privacy scenarios in workspace.spec.ts still sign in independently.
let sessionCookies:
  Awaited<ReturnType<ReturnType<Page["context"]>["cookies"]>> | undefined;

async function login(page: Page) {
  if (sessionCookies) {
    await page.context().addCookies(sessionCookies);
    await page.goto("/#/overview");
    // A hash-only navigation from the public landing retains its mounted session state.
    await page.reload();
  } else {
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByText("Advanced workspace token access", { exact: true })
      .click();
    await page.getByLabel("Workspace access token").fill(token);
    await page.getByRole("button", { name: "Enter workspace" }).click();
  }
  await expect(
    page.getByRole("heading", { name: "Investigation overview" }),
  ).toBeVisible();
  sessionCookies = await page.context().cookies();
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("product foundations, workflow and FAQ are operable without executing work, and sign-in Escape restores focus", async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      mutations.push(request.method());
  });
  await page.goto("/");
  const journal = page.getByRole("button", {
    name: "Inspect Decision journal",
  });
  await journal.focus();
  await journal.press("Enter");
  await expect(journal).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", {
      name: "The record keeps the whole story.",
      exact: true,
    }),
  ).toBeVisible();
  const lab = page.getByRole("button", { name: "Inspect Controlled lab" });
  await lab.focus();
  await lab.press("Enter");
  await expect(lab).toHaveAttribute("aria-pressed", "true");
  await expect(journal).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("heading", {
      name: "Useful work, with clear boundaries.",
      exact: true,
    }),
  ).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Investigation workflow" });
  await tabs.getByRole("tab", { name: /Report/ }).focus();
  await page.keyboard.press("ArrowRight");
  const approval = tabs.getByRole("tab", { name: /Approve/ });
  await expect(approval).toBeFocused();
  await expect(approval).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText(
    "Good questions still need permission.",
  );
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: /Continue/ })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText(
    "A new proposal needing fresh approval",
  );
  await page
    .getByRole("button", { name: "Back to the beginning", exact: true })
    .click();
  await expect(tabs.getByRole("tab", { name: /Report/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("tabpanel").getByRole("heading", {
      name: "A clear signal. A proper starting point.",
      exact: true,
    }),
  ).toBeVisible();
  const question = page
    .locator("details")
    .filter({ hasText: "Can an agent approve its own work?" });
  await question.locator("summary").click();
  await expect(question).toHaveAttribute("open", "");
  await expect(question.locator("p")).toBeVisible();
  await expect(question.locator("p")).toContainText(
    "Execution approval and evidence acceptance are two separate human checkpoints.",
  );
  await question.locator("summary").click();
  await expect(question).not.toHaveAttribute("open", "");
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await signIn.click();
  const dialog = page.getByRole("dialog", { name: "Sign in to Arcloom" });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(signIn).toBeFocused();
  expect(mutations).toEqual([]);
});

test("command search supports keyboard navigation and Escape focus restoration while sidebar collapse preserves destinations", async ({
  page,
}) => {
  await login(page);
  const sidebar = page.locator("#workspace-navigation");
  const initialWidth = (await sidebar.boundingBox())!.width;
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Expand sidebar" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await sidebar.boundingBox())!.width)
    .toBeLessThan(initialWidth);
  await sidebar
    .getByRole("button", { name: "Memory graph", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/memory$/);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(
    page.getByRole("button", { name: "Collapse sidebar" }),
  ).toBeVisible();
  const trigger = page.getByRole("button", { name: "Open command menu" });
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Workspace commands" });
  const search = page.getByRole("combobox", {
    name: "Search workspace commands",
  });
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await search.fill("no-such-workspace-command");
  await expect(dialog.getByRole("option")).toHaveCount(0);
  await expect(dialog.getByRole("status")).toContainText("No commands match");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Meta+k");
  await expect(search).toBeFocused();
  await search.fill("history");
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await expect(
    dialog.getByRole("option", { name: "Activity & evidence" }),
  ).toBeVisible();
  await search.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/#\/activity$/);
  await expect(
    page.getByRole("heading", { name: "Nothing disappears between sessions." }),
  ).toBeVisible();
});

test("mobile navigation keeps the real workspace and graph record list reachable without horizontal overflow at 320 and 390 pixels", async ({
  page,
}) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expectNoOverflow(page);
    const productMenu = page.getByRole("button", {
      name: "Open product menu",
    });
    await productMenu.click();
    const productNavigation = page.getByRole("navigation", {
      name: "Mobile product navigation",
    });
    await expect(productNavigation).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(productNavigation).toHaveCount(0);
    await expect(productMenu).toBeFocused();
    await productMenu.click();
    await productNavigation
      .getByRole("link", { name: "Workflow", exact: true })
      .click();
    await expect(page).toHaveURL(/#workflow$/);
    await expect(productNavigation).toHaveCount(0);
    await expect(
      page.getByRole("tablist", { name: "Investigation workflow" }),
    ).toBeInViewport();
    await expectNoOverflow(page);
  }
  await login(page);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#/overview");
    await expect(
      page.getByRole("heading", { name: "Investigation overview" }),
    ).toBeVisible();
    await expectNoOverflow(page);
    const menu = page.getByRole("button", { name: "Open navigation menu" });
    await menu.click();
    const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(menu).toBeFocused();
    await menu.click();
    await drawer
      .getByRole("button", { name: "Memory graph", exact: true })
      .click();
    await expect(page).toHaveURL(/#\/memory$/);
    await expect(
      page.getByRole("region", { name: "Graph records" }),
    ).toBeVisible();
    await expectNoOverflow(page);
    await page.getByLabel("Filter graph record type").selectOption("Asset");
    await expect(
      page.getByRole("button", { name: /^Inspect record Asset:/ }).first(),
    ).toBeVisible();
    await expectNoOverflow(page);
  }
});

test("graph record selection inspects actual persisted data and activity filters match loaded API events", async ({
  page,
}) => {
  await login(page);
  const graphResponse = await page.request.get("/api/memory");
  expect(graphResponse.ok()).toBe(true);
  const graph = await graphResponse.json();
  const asset = graph.nodes.find(
    (node: { kind: string }) => node.kind === "Asset",
  );
  expect(asset).toBeTruthy();
  await page.goto("/#/memory");
  const records = page.getByRole("region", { name: "Graph records" });
  await expect(records).toBeVisible();
  await page.getByLabel("Filter graph record type").selectOption("Asset");
  await page.getByLabel("Filter graph records").fill(asset.id);
  const title = String(asset.props.title ?? asset.id);
  const record = records.getByRole("button", {
    name: `Inspect record Asset: ${title}`,
    exact: true,
  });
  await expect(record).toBeVisible();
  await record.click();
  const inspector = page.getByRole("complementary", {
    name: "Memory inspector",
  });
  await expect(inspector).toBeFocused();
  await expect(
    inspector.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(inspector.locator(".full-identifier-value").first()).toHaveText(
    asset.id,
  );
  await expect(
    inspector.getByRole("button", {
      name: "Copy graph record ID",
      exact: true,
    }),
  ).toBeVisible();
  await expect(record).toHaveAttribute("aria-pressed", "true");
  await expect(
    inspector.getByRole("heading", { name: "Connected relationships" }),
  ).toBeVisible();
  await page.goto("/#/activity");
  await expect(
    page.getByRole("heading", { name: "Decision ledger" }),
  ).toBeVisible();
  const eventResponse = await page.request.get("/api/events?limit=200");
  expect(eventResponse.ok()).toBe(true);
  const { items } = await eventResponse.json();
  expect(items.length).toBeGreaterThan(0);
  const event = items[0];
  await page.getByLabel("Filter audit event kind").selectOption(event.kind);
  await page.getByLabel("Filter loaded audit events").fill(event.actor);
  const expected = items.filter(
    (item: { kind: string; actor: string; object_id: string; seq: number }) =>
      item.kind === event.kind &&
      `${item.kind} ${item.actor} ${item.object_id} ${item.seq}`
        .toLowerCase()
        .includes(event.actor.toLowerCase()),
  );
  const rows = page.locator(".ledger-event");
  await expect(rows).toHaveCount(expected.length);
  for (const row of await rows.all()) {
    await expect(row.locator("summary")).toContainText(event.actor);
    await expect(row.locator("summary strong")).toHaveText(
      event.kind.replaceAll(".", " / ").replaceAll("_", " "),
    );
  }
  await page
    .getByLabel("Filter loaded audit events")
    .fill("no-such-record-in-this-loaded-journal");
  await expect(
    page.getByRole("heading", { name: "No loaded events match" }),
  ).toBeVisible();
  await expect(rows).toHaveCount(0);
});

test("overview audit windows, keyboard day inspection and snapshot export preserve authorized source data and limits", async ({
  page,
}) => {
  await login(page);
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      mutations.push(request.method());
  });
  const exportButton = page.getByRole("button", {
    name: "Export snapshot",
    exact: true,
  });
  await expect(exportButton).toBeEnabled();
  const [auditResponse, casesResponse, dashboardResponse] = await Promise.all([
    page.request.get("/api/events?limit=200"),
    page.request.get("/api/investigations?limit=100"),
    page.request.get("/api/dashboard"),
  ]);
  expect(auditResponse.ok()).toBe(true);
  expect(casesResponse.ok()).toBe(true);
  expect(dashboardResponse.ok()).toBe(true);
  const audit = await auditResponse.json();
  const investigations = await casesResponse.json();
  const dashboard = await dashboardResponse.json();
  const panel = page.getByRole("region", { name: "Loaded audit activity" });
  await expect(panel.locator(".insights-source-note")).toContainText(
    `Source: ${audit.items.length} events loaded from the first audit page.`,
  );
  await expect(panel).toContainText(
    audit.has_more
      ? "More audit history exists outside this page"
      : "The loaded audit page has no further events",
  );
  const lastDay = new Date(dashboard.at * 1000);
  lastDay.setUTCHours(0, 0, 0, 0);
  const dateLabel = (day: Date) =>
    new Intl.DateTimeFormat("en", {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(day);
  const countOnDate = (day: Date, asOf: number) =>
    audit.items.filter(
      (event: { at: number }) =>
        event.at <= asOf &&
        new Date(event.at * 1000).toISOString().slice(0, 10) ===
          day.toISOString().slice(0, 10),
    ).length;
  const windowControl = page.getByRole("group", {
    name: "Audit activity window",
  });
  const slider = panel.getByRole("slider", { name: "Inspect a day" });
  for (const days of [7, 30]) {
    await windowControl
      .getByRole("button", { name: `${days} days`, exact: true })
      .click();
    await expect(
      windowControl.getByRole("button", {
        name: `${days} days`,
        exact: true,
      }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(slider).toHaveAttribute("max", String(days - 1));
    await expect(panel.locator(".insights-audit-chart rect")).toHaveCount(days);
    await slider.focus();
    await slider.press("Home");
    await expect(slider).toHaveValue("0");
    const firstDay = new Date(lastDay);
    firstDay.setUTCDate(firstDay.getUTCDate() - days + 1);
    await expect(slider).toHaveAttribute(
      "aria-valuetext",
      `${dateLabel(firstDay)}: ${countOnDate(firstDay, dashboard.at)} loaded events`,
    );
    await slider.press("End");
    await expect(slider).toHaveValue(String(days - 1));
    await slider.press("ArrowLeft");
    await expect(slider).toHaveValue(String(days - 2));
    const previousDay = new Date(lastDay);
    previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    await expect(slider).toHaveAttribute(
      "aria-valuetext",
      `${dateLabel(previousDay)}: ${countOnDate(previousDay, dashboard.at)} loaded events`,
    );
  }
  await panel.getByText("View daily event counts", { exact: true }).click();
  const table = panel.getByRole("table", {
    name: "First loaded audit page, grouped by UTC date",
  });
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(30);
  const downloaded = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(
    /^arcloom-workspace-snapshot-\d{4}-\d{2}-\d{2}\.json$/,
  );
  const snapshot = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(snapshot.schemaVersion).toBe(1);
  expect(snapshot.exported_from_server_at).toBe(snapshot.dashboard.at);
  expect(snapshot.dashboard.workspace).toBe(dashboard.workspace);
  expect(snapshot.audit.request).toBe("/api/events?limit=200");
  expect(snapshot.audit.items).toEqual(audit.items);
  expect(snapshot.audit.loaded).toBe(audit.items.length);
  expect(snapshot.audit.has_more).toBe(audit.has_more);
  expect(snapshot.audit.scope).toContain(
    "First loaded audit page; not a complete-history export when has_more is true.",
  );
  expect(snapshot.audit.error).toBeNull();
  expect(snapshot.investigations.request).toBe("/api/investigations?limit=100");
  expect(snapshot.investigations.items).toEqual(investigations.items);
  expect(snapshot.investigations.loaded).toBe(investigations.items.length);
  expect(snapshot.investigations.total).toBe(investigations.total);
  expect(snapshot.investigations.error).toBeNull();
  expect(snapshot.chart.window_days).toBe(30);
  expect(snapshot.chart.timezone).toBe("UTC");
  expect(snapshot.chart.daily_counts).toHaveLength(30);
  let total = 0;
  for (const [index, item] of snapshot.chart.daily_counts.entries()) {
    const day = new Date(item.day * 1000);
    expect(day.getUTCHours()).toBe(0);
    const actualCount = countOnDate(day, snapshot.exported_from_server_at);
    expect(item.count).toBe(actualCount);
    total += actualCount;
    const row = table.locator("tbody tr").nth(index);
    await expect(row.locator("td").nth(0)).toHaveText(dateLabel(day));
    await expect(row.locator("td").nth(1)).toHaveText(String(actualCount));
  }
  await expect(panel.locator(".insights-chart-summary strong")).toHaveText(
    String(total),
  );
  await expect(
    page.getByText(
      "Workspace snapshot exported with loaded data and its source limits.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(mutations).toEqual([]);
});
