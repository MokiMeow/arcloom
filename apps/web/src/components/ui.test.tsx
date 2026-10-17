// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ErrorNotice, Loading, StateBadge } from "./ui";
afterEach(cleanup);
describe("truthful accessible investigation states", () => {
  it("never presents an untested hypothesis as confirmed", () => {
    render(<StateBadge state="awaiting_approval" />);
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
  });
  it("separates historical proof from current status", () => {
    render(<StateBadge state="confirmed" stale />);
    expect(screen.getByText("Confirmed · historical")).toBeInTheDocument();
  });
  it("announces errors without injecting HTML", () => {
    render(<ErrorNotice message="<script>untrusted</script>" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "<script>untrusted</script>",
    );
    expect(document.querySelector("script")).toBeNull();
  });
  it("hides empty error notices", () => {
    render(<ErrorNotice message={null} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("announces asynchronous loading", () => {
    render(<Loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading workspace");
  });
});
