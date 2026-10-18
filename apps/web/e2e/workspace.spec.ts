import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

function canonicalPacket(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalPacket).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalPacket(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

type BrowserToolTest = {
  execute: (input: Record<string, unknown>) => Promise<string>;
  annotations: { readOnlyHint: boolean };
};
type BrowserToolTestState = Window & {
  arcloomTestTools: Map<string, BrowserToolTest>;
};

const token = "arcloom-e2e-only-" + "t".repeat(48);
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Workspace access token").fill(token);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Investigation overview",
    }),
  ).toBeVisible();
}
async function verify(page: Page) {
  await page
    .getByLabel("Decision rationale")
    .fill("Authorized registered lab test; scope and revision reviewed.");
  await page.getByRole("button", { name: "Approve lab test" }).click();
  await expect(
    page.getByRole("button", { name: "Accept recorded outcome" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verify evidence integrity" }).click();
  await expect(
    page.getByText("Integrity verified against stored bytes"),
  ).toBeVisible();
  await page
    .getByLabel("Decision rationale")
    .fill("Actual observations and signed evidence independently inspected.");
  await page.getByRole("button", { name: "Accept recorded outcome" }).click();
  await expect(
    page.getByRole("button", { name: "Investigate connected paths" }),
  ).toBeVisible();
}

test("real report, evidence, fresh agents, chain, graph and revision revalidation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.getByRole("button", { name: "New report", exact: true }).click();
  await page
    .getByLabel("Registered reproduction test")
    .selectOption("gateway-boundary");
  await page.getByLabel("Original researcher").fill("Arcloom E2E researcher");
  await page
    .getByLabel("What did you observe?")
    .fill(
      "The synthetic gateway boundary returns an internal route without the expected authorization.",
    );
  await page.getByRole("button", { name: "Create investigation" }).click();
  await verify(page);
  const gatewayUrl = page.url();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export handoff", exact: true }),
  ).toBeEnabled();
  await page
    .locator(".handoff-brief summary")
    .filter({ hasText: "Verified evidence" })
    .click();
  await expect(
    page.getByText("Receipt signature verified", { exact: true }),
  ).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export handoff", exact: true })
    .click();
  const downloaded = await downloadEvent;
  const packet = JSON.parse(await readFile((await downloaded.path())!, "utf8"));
  const { packet_sha256: packetDigest, ...payload } = packet;
  expect(packetDigest).toBe(
    createHash("sha256").update(canonicalPacket(payload), "utf8").digest("hex"),
  );
  expect(packet.summary.confirmed_current).toBe(1);
  expect(
    packet.candidates.some(
      (candidate: { test_id: string }) =>
        candidate.test_id === "invoice-tenant-boundary",
    ),
  ).toBe(true);
  expect(packet.findings[0].evidence.signature_verified).toBe(true);
  await page.locator(".handoff-case").first().click();
  await expect(page).toHaveURL(gatewayUrl);
  await page
    .getByRole("button", { name: "Investigate connected paths" })
    .click();
  await expect(
    page.getByText("1 supporting finding(s)", { exact: false }),
  ).toBeVisible();
  await verify(page);
  await page
    .getByRole("button", { name: "Investigate connected paths" })
    .click();
  await expect(
    page.getByText("2 supporting finding(s)", { exact: false }),
  ).toBeVisible();
  await verify(page);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.locator(".stat").first().locator("strong")).toHaveText(
    "03",
  );
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Memory graph", exact: true }).click();
  await page.getByLabel("Graph focus").selectOption("");
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  await page.getByRole("button", { name: "Read labels", exact: true }).click();
  const node = page.getByRole("button", { name: /^Inspect Report:/ }).first();
  await expect(node).toBeInViewport();
  await expect
    .poll(async () => (await node.boundingBox())?.width ?? 0)
    .toBeGreaterThan(270);
  await node.focus();
  await node.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Connected relationships" }),
  ).toBeVisible();
  const graphClearance = await page
    .locator(".graph-canvas")
    .evaluate((canvas) => {
      const boxes = (selector: string) =>
        [...canvas.querySelectorAll(selector)].map((element) =>
          element.getBoundingClientRect(),
        );
      const cards = boxes(".react-flow__node");
      const labels = boxes(".graph-edge-label");
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top;
      return {
        labels: labels.length,
        overlaps: labels.filter(
          (label, index) =>
            cards.some((card) => overlaps(label, card)) ||
            labels.slice(index + 1).some((other) => overlaps(label, other)),
        ).length,
      };
    });
  expect(graphClearance.labels).toBeGreaterThan(0);
  expect(graphClearance.overlaps).toBe(0);
  await page.getByRole("button", { name: "Fit graph", exact: true }).click();
  await page.getByLabel("Search graph memory").fill("invoice");
  await page.getByRole("button", { name: "Search graph", exact: true }).click();
  await expect(page.getByText(/indexed matches/)).toBeVisible();
  const gatewayOption = await page
    .getByLabel("Finding to withdraw")
    .locator("option")
    .evaluateAll(
      (options) =>
        options
          .map((option) => ({
            value: (option as HTMLOptionElement).value,
            text: option.textContent ?? "",
          }))
          .find((option) => option.text.includes("Gateway"))?.value,
    );
  expect(gatewayOption).toBeTruthy();
  await page.getByLabel("Finding to withdraw").selectOption(gatewayOption!);
  await page.getByRole("button", { name: "Run withdrawal analysis" }).click();
  await expect(page.getByText(/Supported test prerequisites:/)).toBeVisible();
  await page
    .getByRole("button", { name: "Inspect native query plan and PageRank" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Dependency importance" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/memory.png", fullPage: true });
  await page
    .getByRole("button", { name: "Workspace policy", exact: true })
    .click();
  await page
    .getByLabel("Policy change rationale")
    .fill(
      "Advance the synthetic fixture to its patched deployment for revalidation.",
    );
  await page.getByRole("button", { name: "Advance lab to patched r2" }).click();
  await expect(page.locator(".revision-pill")).toHaveText("r2");
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.locator(".stat").first().locator("strong")).toHaveText(
    "00",
  );
  await page.locator(".case-row").first().click();
  await expect(page.getByText("This conclusion is historical.")).toBeVisible();
  await page
    .getByRole("button", { name: "Revalidate on current revision" })
    .click();
  await page
    .getByLabel("Decision rationale")
    .fill("Recheck the original evidence on the patched fixture.");
  await page.getByRole("button", { name: "Approve lab test" }).click();
  await expect(
    page.getByRole("button", { name: "Accept recorded outcome" }),
  ).toBeVisible();
  await page
    .getByLabel("Decision rationale")
    .fill(
      "Patched revision denies the previous chain; preserve the historical finding.",
    );
  await page.getByRole("button", { name: "Accept recorded outcome" }).click();
  await expect(page.locator(".state-not_reproduced")).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile navigation, accessible dialog cancellation and no browser token persistence", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "New report", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  await menu.click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("button", { name: "Memory graph", exact: true }).click();
  await expect(page).toHaveURL(/#\/memory$/);
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await menu.click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "arcloom_session",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
});

test("investigation links survive reload and browser history", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "New report", exact: true }).click();
  await page
    .getByLabel("Registered reproduction test")
    .selectOption("gateway-boundary");
  await page.getByLabel("Original researcher").fill("Link persistence review");
  await page
    .getByLabel("What did you observe?")
    .fill("Registered synthetic observation for navigation verification.");
  await page.getByRole("button", { name: "Create investigation" }).click();
  await expect(page).toHaveURL(/#\/investigations\/case_/);
  const caseUrl = page.url();
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Gateway trusts an unverified routing context",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page).toHaveURL(/#\/overview$/);
  await page.goBack();
  await expect(page).toHaveURL(caseUrl);
  await expect(
    page.getByRole("button", { name: "All investigations" }),
  ).toBeVisible();
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await skip.focus();
  await skip.click();
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(page).toHaveURL(caseUrl);
});

test("invalid access token stays outside the workspace", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Workspace access token")
    .fill("unrecognized-" + "x".repeat(48));
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(0);
});

test("a slow investigator cannot override navigation chosen while it runs", async ({
  page,
}) => {
  await login(page);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/agents/discover", async (route) => {
    await pending;
    await route.fulfill({
      json: { case_id: "case_late_response", status: "proposed" },
    });
  });
  await page.getByRole("button", { name: "Start fresh investigator" }).click();
  await page.getByRole("button", { name: "Memory graph", exact: true }).click();
  const response = page.waitForResponse("**/api/agents/discover");
  finish();
  await response;
  await expect(
    page.getByRole("heading", {
      name: "Show the path behind the next question.",
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/memory$/);
});

test("one-time member tokens survive refresh and viewer actions stay read-only", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Workspace policy", exact: true })
    .click();
  await page.getByLabel("Member name").fill("Browser review viewer");
  await page.getByLabel("Member role").selectOption("viewer");
  await page.getByRole("button", { name: "Create access token" }).click();
  await expect(page.locator(".member-list")).toContainText(
    "Browser review viewer",
  );
  const issuedToken = page.locator(".one-time-token code");
  await expect(issuedToken).toBeVisible();
  const value = (await issuedToken.textContent())!;
  expect(value.length).toBeGreaterThanOrEqual(32);
  await page.getByRole("button", { name: "Sign out of workspace" }).click();
  await page.getByLabel("Workspace access token").fill(value);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Investigation overview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "New report", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start fresh investigator", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Investigations", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Submit report" })).toHaveCount(
    0,
  );
});

test("provider keys persist privately and cloud staging leaves the current graph active", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Workspace policy", exact: true })
    .click();
  const key = "public-e2e-gemini-placeholder";
  await page
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("gemini");
  await page
    .getByLabel("Model ID", { exact: true })
    .fill("gemini-3.5-flash-lite");
  await page.getByLabel("API key", { exact: true }).fill(key);
  await page
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await expect(
    page.getByText(
      "Provider saved. New investigators will use this configuration.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  const providerState = await (await page.request.get("/api/providers")).json();
  expect(JSON.stringify(providerState)).not.toContain(key);
  expect(providerState.active_provider).toBe("gemini");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Provider", exact: true }),
  ).toHaveValue("gemini");
  await expect(page.getByLabel("API key", { exact: true })).toHaveValue("");
  await expect(page.getByText(/Key configured. Leave blank/)).toBeVisible();

  const password = "public-e2e-cloud-password";
  await page
    .getByLabel("Cloud endpoint (host)", { exact: true })
    .fill("disposable.example.com");
  await page.getByLabel("Cloud port", { exact: true }).fill("12345");
  await page.getByLabel("Cloud username", { exact: true }).fill("falkordb");
  await page.getByLabel("Cloud password", { exact: true }).fill(password);
  await page.getByLabel("TLS enabled", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save cloud connection", exact: true })
    .click();
  await expect(
    page.getByText(
      "Cloud connection staged. The current graph server has not changed.",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("Cloud password", { exact: true })).toHaveValue(
    "",
  );
  const hostingState = await (
    await page.request.get("/api/graph-hosting")
  ).json();
  expect(JSON.stringify(hostingState)).not.toContain(password);
  expect(hostingState.current.host).not.toBe("disposable.example.com");
  expect(hostingState.target.host).toBe("disposable.example.com");
  await page
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("deterministic");
  await page
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await expect(
    page.getByText(
      "Provider saved. New investigators will use this configuration.",
    ),
  ).toBeVisible();
});

test("browser agent tools read the actual authenticated API and unregister on logout", async ({
  page,
}) => {
  // This exercises browser integration with a test adapter, not native WebMCP availability.
  await page.addInitScript(() => {
    const state = window as BrowserToolTestState;
    state.arcloomTestTools = new Map();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: (
          tool: BrowserToolTest & { name: string },
          options: { signal: AbortSignal },
        ) => {
          state.arcloomTestTools.set(tool.name, tool);
          options.signal.addEventListener(
            "abort",
            () => state.arcloomTestTools.delete(tool.name),
            { once: true },
          );
        },
      },
    });
  });
  await login(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...(window as BrowserToolTestState).arcloomTestTools.keys()].sort(),
      ),
    )
    .toEqual([
      "arcloom_handoff",
      "arcloom_investigation",
      "arcloom_investigations",
    ]);
  const result = await page.evaluate(async () => {
    const tools = (window as BrowserToolTestState).arcloomTestTools;
    const handoff = JSON.parse(await tools.get("arcloom_handoff")!.execute({}));
    const investigations = JSON.parse(
      await tools.get("arcloom_investigations")!.execute({ limit: 2 }),
    );
    return {
      readOnly: [...tools.values()].every(
        (tool) => tool.annotations.readOnlyHint,
      ),
      schemaVersion: handoff.schemaVersion,
      validAudit: handoff.audit.valid,
      count: investigations.items.length,
    };
  });
  expect(result).toMatchObject({
    readOnly: true,
    schemaVersion: 1,
    validAudit: true,
  });
  expect(result.count).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "Sign out of workspace" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as BrowserToolTestState).arcloomTestTools.size,
      ),
    )
    .toBe(0);
});
