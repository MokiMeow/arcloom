import { expect, test } from "@playwright/test";

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`recorded demo navigation and exports at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    const apiRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/"))
        apiRequests.push(r.url());
    });
    async function contained() {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator(".notice.error")).toHaveCount(0);
    }
    async function navigate(name: string) {
      const menu = page.getByRole("button", { name: "Open navigation menu" });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Investigation overview" }),
    ).toBeVisible();
    await contained();
    const handoff = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export handoff", exact: true })
      .click();
    expect((await handoff).suggestedFilename()).toMatch(/\.json$/);
    await navigate("Investigations");
    await expect(page.locator(".row-title").first()).toBeVisible();
    await contained();
    await page
      .locator(".row-title")
      .filter({ hasText: "Invoice service" })
      .first()
      .click();
    await page
      .getByRole("button", { name: "View recorded integrity check" })
      .click();
    await expect(
      page.getByRole("button", { name: "Recorded integrity check passed" }),
    ).toBeVisible();
    const exported = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export investigation JSON" }).click();
    await exported;
    await contained();
    await navigate("Memory graph");
    await expect(page.locator(".react-flow")).toBeVisible();
    await contained();
    await page
      .getByRole("combobox", { name: "Finding to withdraw" })
      .selectOption({ index: 1 });
    await page
      .getByRole("button", { name: "View recorded withdrawal analysis" })
      .click();
    await page
      .getByRole("button", { name: "Inspect recorded query plan and PageRank" })
      .click();
    await contained();
    await navigate("Activity & evidence");
    await page
      .getByRole("button", { name: "View recorded audit check" })
      .click();
    await contained();
    await navigate("Workspace policy");
    await expect(
      page.getByText("Recorded policy view", { exact: true }),
    ).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await contained();
    await page
      .getByRole("combobox", { name: "Recorded demo state" })
      .selectOption("r2");
    await expect(
      page.getByRole("heading", { name: "Investigation overview" }),
    ).toBeVisible();
    await navigate("Investigations");
    await page
      .locator(".row-title")
      .filter({ hasText: "Invoice service" })
      .first()
      .click();
    await expect(
      page.getByText("This conclusion is historical.", { exact: false }),
    ).toBeVisible();
    await contained();
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
  });
}
