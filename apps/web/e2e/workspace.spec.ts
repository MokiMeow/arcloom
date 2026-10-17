import { expect, test, type Page } from "@playwright/test";

const token = "arcloom-e2e-only-" + "t".repeat(48);
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Workspace access token").fill(token);
  await page.getByRole("button", { name: "Enter workspace" }).click();
  await expect(
    page.getByRole("heading", {
      name: "The session ends. The knowledge stays.",
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
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "arcloom_session",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
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
