import { expect, test, type Page } from "@playwright/test";

const originalPassword = "public-account-test-passphrase-2026";
const changedPassword = "public-changed-test-passphrase-2026";
const recoveredPassword = "public-recovered-test-passphrase-2026";

async function openAccess(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

async function acknowledgeRecovery(page: Page) {
  const code = await page
    .getByRole("textbox", { name: "Your recovery code", exact: true })
    .inputValue();
  expect(code.length).toBeGreaterThanOrEqual(24);
  const enter = page.getByRole("button", {
    name: "Enter workspace",
    exact: true,
  });
  await expect(enter).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Save your recovery code" }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Save your recovery code",
  );
  await page
    .getByRole("checkbox", {
      name: "I saved this recovery code somewhere safe.",
    })
    .check();
  await enter.click();
  await expect(
    page.getByRole("heading", { name: "Investigation overview" }),
  ).toBeVisible();
  return code;
}

async function register(page: Page, email: string, name: string) {
  await openAccess(page);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Your name", exact: true }),
  ).toBeFocused();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(originalPassword);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(originalPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(
    page.getByRole("dialog", { name: "Save your recovery code" }),
  ).toBeVisible();
  return acknowledgeRecovery(page);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out of workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
}

async function login(page: Page, email: string, password: string) {
  await openAccess(page);
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in with email" }).click();
  await expect(
    page.getByRole("heading", { name: "Investigation overview" }),
  ).toBeVisible();
}

async function assertEmptyWorkspace(page: Page) {
  const response = await page.request.get("/api/dashboard");
  expect(response.ok()).toBe(true);
  const dashboard = await response.json();
  expect(Object.values(dashboard.counts).every((count) => count === 0)).toBe(
    true,
  );
  expect(dashboard.verified_current).toBe(0);
  expect(dashboard.findings).toEqual([]);
  const cases = await page.request.get("/api/investigations?limit=100");
  expect(cases.ok()).toBe(true);
  expect((await cases.json()).items).toEqual([]);
  await expect(
    page.getByRole("button", { name: "Submit first report", exact: true }),
  ).toBeVisible();
}

async function session(page: Page) {
  const response = await page.request.get("/api/auth/session");
  expect(response.ok()).toBe(true);
  return response.json();
}

test("individual signup, current-password verification and one-use recovery codes work against the private workspace", async ({
  page,
  playwright,
}) => {
  const email = "account-lifecycle@example.test";
  const recoveryCode = await register(
    page,
    email,
    "Account lifecycle researcher",
  );
  await assertEmptyWorkspace(page);
  const initial = await session(page);
  expect(initial.actor.email).toBe(email);
  expect(initial.actor.password_account).toBe(true);
  expect(initial.actor.role).toBe("admin");
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  await signOut(page);
  await login(page, email, originalPassword);
  const priorSession = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:8000",
    storageState: { cookies: await page.context().cookies(), origins: [] },
  });
  try {
    await page
      .getByRole("button", { name: "Workspace policy", exact: true })
      .click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.getByText("Change password", { exact: true }).click();
    await page
      .getByLabel("Current password", { exact: true })
      .fill("public-incorrect-current-password");
    await page
      .getByLabel("New password", { exact: true })
      .fill(changedPassword);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(changedPassword);
    const incorrect = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/auth/password") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Update password" }).click();
    expect((await incorrect).status()).toBe(401);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Account & sign-in" }),
    ).toBeVisible();
    expect((await priorSession.get("/api/auth/session")).status()).toBe(200);
    await page
      .getByLabel("Current password", { exact: true })
      .fill(originalPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Password changed." }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Current password", { exact: true }),
    ).toHaveValue("");
    expect((await priorSession.get("/api/auth/session")).status()).toBe(401);
    expect((await session(page)).actor.id).toBe(initial.actor.id);
    // A write after renewal proves the parent's CSRF/session hook was updated.
    await signOut(page);
  } finally {
    await priorSession.dispose();
  }
  await login(page, email, changedPassword);
  await signOut(page);
  await openAccess(page);
  await page
    .getByRole("button", { name: "Reset account access", exact: true })
    .click();
  await expect(page.getByText(/No reset email will be sent/)).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Saved recovery code").fill(recoveryCode);
  await page
    .getByLabel("New password", { exact: true })
    .fill(recoveredPassword);
  await page
    .getByLabel("Confirm password", { exact: true })
    .fill(recoveredPassword);
  await page
    .getByRole("button", { name: "Reset account access", exact: true })
    .click();
  const replacement = await acknowledgeRecovery(page);
  expect(replacement === recoveryCode).toBe(false);
  const rejectedOldCode = await page.request.post("/api/auth/recover", {
    data: {
      email,
      recovery_code: recoveryCode,
      new_password: originalPassword,
    },
  });
  expect(rejectedOldCode.status()).toBe(401);
  const usedReplacement = await page.request.post("/api/auth/recover", {
    data: { email, recovery_code: replacement, new_password: changedPassword },
  });
  expect(usedReplacement.status()).toBe(200);
  const renewed = await usedReplacement.json();
  expect(renewed.actor.id).toBe(initial.actor.id);
  expect(typeof renewed.recovery_code).toBe("string");
  expect(renewed.recovery_code === replacement).toBe(false);
  const rejectedReuse = await page.request.post("/api/auth/recover", {
    data: { email, recovery_code: replacement, new_password: originalPassword },
  });
  expect(rejectedReuse.status()).toBe(401);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Investigation overview" }),
  ).toBeVisible();
  expect((await session(page)).actor.id).toBe(initial.actor.id);
});

test("separate individual accounts cannot read another workspace's investigations or provider configuration", async ({
  page,
}) => {
  await register(page, "isolation-owner@example.test", "Isolation owner");
  const first = await session(page);
  await page.getByRole("button", { name: "New report", exact: true }).click();
  await page
    .getByLabel("Registered reproduction test")
    .selectOption("gateway-boundary");
  const title = "Private account observation stays in its own workspace";
  await page.getByLabel("Report title").fill(title);
  await page.getByLabel("Original researcher").fill("Isolation owner");
  await page
    .getByLabel("What did you observe?")
    .fill(
      "A bounded synthetic observation recorded for account isolation verification.",
    );
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/reports") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create investigation" }).click();
  const reportResponse = await created;
  expect(reportResponse.status()).toBe(201);
  const { case_id: caseId } = await reportResponse.json();
  await expect(page).toHaveURL(new RegExp(`#/investigations/${caseId}$`));
  await page
    .getByRole("button", { name: "Workspace policy", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Provider", exact: true })
    .selectOption("gemini");
  await page
    .getByLabel("Model ID", { exact: true })
    .fill("gemini-account-isolation-test");
  await page
    .getByLabel("API key", { exact: true })
    .fill("public-test-provider-placeholder-never-live");
  await page
    .getByRole("button", { name: "Save provider", exact: true })
    .click();
  await expect(
    page.getByText(
      "Provider saved. New investigators will use this configuration.",
    ),
  ).toBeVisible();
  expect(
    (await (await page.request.get("/api/providers")).json()).active_provider,
  ).toBe("gemini");
  await signOut(page);
  await register(
    page,
    "isolation-second@example.test",
    "Separate account owner",
  );
  const second = await session(page);
  expect(second.actor.tenant === first.actor.tenant).toBe(false);
  expect(second.actor.id === first.actor.id).toBe(false);
  await assertEmptyWorkspace(page);
  expect(
    (await page.request.get(`/api/investigations/${caseId}`)).status(),
  ).toBe(404);
  const providerResponse = await page.request.get("/api/providers");
  expect(providerResponse.ok()).toBe(true);
  const provider = await providerResponse.json();
  expect(provider.active_provider).toBe("deterministic");
  expect(
    provider.providers.find((item: { id: string }) => item.id === "gemini")
      .key_configured,
  ).toBe(false);
  expect(JSON.stringify(provider)).not.toContain(
    "gemini-account-isolation-test",
  );
  expect(JSON.stringify(provider)).not.toContain(
    "public-test-provider-placeholder-never-live",
  );
  const graphResponse = await page.request.get("/api/memory");
  expect(graphResponse.ok()).toBe(true);
  const graph = await graphResponse.json();
  expect(
    graph.nodes.some(
      (node: { id: string; props: Record<string, unknown> }) =>
        node.id === caseId || node.props.case_id === caseId,
    ),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Investigations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Investigations", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: title, exact: true }),
  ).toHaveCount(0);
});

async function widgetOrder(page: Page) {
  return page
    .locator("[data-dashboard-widget]")
    .evaluateAll((widgets) =>
      widgets.map((widget) => widget.getAttribute("data-dashboard-widget")),
    );
}

test("dashboard keyboard and pointer rearrangement, width, account persistence and reset store only layout preferences", async ({
  page,
}) => {
  const email = "layout-owner@example.test";
  const code = await register(page, email, "Dashboard layout owner");
  const identity = await session(page);
  const initialOrder = await widgetOrder(page);
  expect(initialOrder.length).toBeGreaterThan(2);
  const initialWidths = await page
    .locator("[data-dashboard-widget]")
    .evaluateAll((widgets) =>
      widgets
        .filter((widget) => widget.getAttribute("data-layout-size") === "wide")
        .map((widget) => widget.getAttribute("data-dashboard-widget")),
    );
  const writes: string[] = [];
  const track = (request: import("@playwright/test").Request) => {
    if (
      request.url().includes("/api/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      writes.push(request.method());
  };
  page.on("request", track);
  await page
    .getByRole("button", { name: "Customize layout", exact: true })
    .click();
  const queueHandle = page.getByRole("button", {
    name: "Drag Investigation queue",
    exact: true,
  });
  await queueHandle.focus();
  await queueHandle.press("ArrowUp");
  await expect(queueHandle).toBeFocused();
  const keyboardOrder = [...initialOrder];
  const queueIndex = keyboardOrder.indexOf("queue");
  [keyboardOrder[queueIndex - 1], keyboardOrder[queueIndex]] = [
    keyboardOrder[queueIndex],
    keyboardOrder[queueIndex - 1],
  ];
  await expect.poll(() => widgetOrder(page)).toEqual(keyboardOrder);
  await page
    .locator('[data-dashboard-widget="composition"]')
    .evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
  const handle = page.getByRole("button", {
    name: "Drag Workspace status",
    exact: true,
  });
  await expect(handle).toBeInViewport({ ratio: 1 });
  const start = (await handle.boundingBox())!;
  const target = (await page
    .locator('[data-dashboard-widget="composition"]')
    .boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 + 12,
    start.y + start.height / 2 + 3,
    { steps: 3 },
  );
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + Math.min(70, target.height / 4),
    { steps: 15 },
  );
  await expect(
    page.getByText("Drop before Case composition", { exact: true }),
  ).toBeVisible();
  await page.mouse.up();
  const expectedOrder = keyboardOrder.filter((id) => id !== "health");
  expectedOrder.splice(expectedOrder.indexOf("composition"), 0, "health");
  await expect.poll(() => widgetOrder(page)).toEqual(expectedOrder);
  await page
    .getByRole("button", { name: "Expand Workspace status", exact: true })
    .click();
  const health = page.locator('[data-dashboard-widget="health"]');
  await expect(health).toHaveAttribute("data-layout-size", "wide");
  const storage = await page.evaluate(() => Object.entries(localStorage));
  expect(storage).toHaveLength(1);
  const [key, value] = storage[0];
  expect(key).toBe(
    `arcloom:dashboard-layout:v1:${encodeURIComponent(`${identity.actor.tenant}:${identity.actor.id}`)}`,
  );
  const preference = JSON.parse(value);
  expect(Object.keys(preference).sort()).toEqual(["order", "version", "wide"]);
  expect(preference.version).toBe(1);
  expect(preference.order).toEqual(expectedOrder);
  expect(preference.wide).toContain("health");
  for (const credential of [email, originalPassword, code, identity.csrf])
    expect(value).not.toContain(credential);
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual([]);
  expect(writes).toEqual([]);
  page.off("request", track);
  await page
    .getByRole("button", { name: "Done arranging", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Investigation overview" }),
  ).toBeVisible();
  await expect.poll(() => widgetOrder(page)).toEqual(expectedOrder);
  await expect(health).toHaveAttribute("data-layout-size", "wide");
  await signOut(page);
  await login(page, email, originalPassword);
  await expect.poll(() => widgetOrder(page)).toEqual(expectedOrder);
  await expect(health).toHaveAttribute("data-layout-size", "wide");
  await page
    .getByRole("button", { name: "Customize layout", exact: true })
    .click();
  await page.getByRole("button", { name: "Reset layout", exact: true }).click();
  await expect.poll(() => widgetOrder(page)).toEqual(initialOrder);
  const resetWidths = await page
    .locator("[data-dashboard-widget]")
    .evaluateAll((widgets) =>
      widgets
        .filter((widget) => widget.getAttribute("data-layout-size") === "wide")
        .map((widget) => widget.getAttribute("data-dashboard-widget")),
    );
  expect(resetWidths).toEqual(initialWidths);
  expect(await page.evaluate(() => Object.entries(localStorage))).toEqual([]);
});
