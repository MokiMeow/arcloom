// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
