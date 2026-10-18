// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoRequest } from "./api";
import type { CasePage, Dashboard, Session } from "../types";

afterEach(() => vi.unstubAllGlobals());

describe("public recorded demo", () => {
  it("has a viewer identity and no authentication token", async () => {
    const session = await demoRequest<Session>(
      "/api/auth/session",
      "GET",
      undefined,
      "r1",
    );
    expect(session.actor.role).toBe("viewer");
    expect(session.csrf).toBeNull();
  });
  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "blocks %s without any network request",
    async (method) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(
        demoRequest("/api/agents/discover", method),
      ).rejects.toMatchObject({ code: "demo_read_only" });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("keeps the two actual recorded revisions separate", async () => {
    const before = await demoRequest<Dashboard>(
      "/api/dashboard",
      "GET",
      undefined,
      "r1",
    );
    const after = await demoRequest<Dashboard>(
      "/api/dashboard",
      "GET",
      undefined,
      "r2",
    );
    expect(before.revision).toBe("r1");
    expect(after.revision).toBe("r2");
    expect(before.verified_current).toBeGreaterThan(0);
    expect(after.verified_historical).toBeGreaterThan(0);
  });
  it("filters and paginates the recorded inbox without changing the snapshot", async () => {
    const result = await demoRequest<CasePage>(
      "/api/investigations?q=invoice&state=confirmed&limit=1",
      "GET",
      undefined,
      "r1",
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title.toLowerCase()).toContain("invoice");
    result.items[0].title = "changed";
    const again = await demoRequest<CasePage>(
      "/api/investigations?q=invoice&state=confirmed&limit=1",
      "GET",
      undefined,
      "r1",
    );
    expect(again.items[0].title).not.toBe("changed");
  });
  it("does not substitute another endpoint when a record is absent", async () => {
    await expect(demoRequest("/api/providers", "GET")).rejects.toMatchObject({
      code: "demo_not_recorded",
    });
  });
});
