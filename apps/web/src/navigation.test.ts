import { describe, expect, it } from "vitest";
import { locationFor, readLocation } from "./navigation";

describe("workspace locations", () => {
  it.each([
    "overview",
    "investigations",
    "memory",
    "activity",
    "settings",
  ] as const)("restores the %s section from its URL", (view) => {
    expect(readLocation(`#/${view}`)).toEqual({ view, caseId: null });
    expect(locationFor(view)).toBe(`#/${view}`);
  });

  it("preserves encoded investigation IDs when sharing a deep link", () => {
    expect(readLocation("#/investigations/case%2Fone%20%23two")).toEqual({
      view: "investigations",
      caseId: "case/one #two",
    });
    expect(locationFor("investigations", "case/one #two")).toBe(
      "#/investigations/case%2Fone%20%23two",
    );
  });

  it.each([
    "",
    "#",
    "#/missing",
    "#/settings/private",
    "#/investigations/",
    "#/investigations/%E0%A4%A",
    "#/investigations/a/b",
  ])("safely defaults an invalid location %s", (hash) => {
    expect(readLocation(hash)).toEqual({ view: "overview", caseId: null });
  });

  it("does not attach a case ID to a different section", () => {
    expect(locationFor("memory", "case-1")).toBe("#/memory");
  });
});
