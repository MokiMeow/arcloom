// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Landing } from "./Landing";
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../api", () => ({
  request,
  errorText: (error: Error) => error.message,
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function openAccess(authenticated = vi.fn()) {
  render(<Landing authenticated={authenticated} />);
  const opener = screen.getByRole("button", { name: "Sign in" });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByText("Advanced workspace token access"));
  return {
    authenticated,
    opener,
    input: screen.getByLabelText("Workspace access token"),
  };
}

describe("sky landing access and product exploration", () => {
  it("requires an explicit sign-in action and restores focus after Escape", () => {
    render(<Landing authenticated={vi.fn()} />);
    expect(
      screen.queryByLabelText("Workspace access token"),
    ).not.toBeInTheDocument();
    const opener = screen.getByRole("button", { name: "Sign in" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Sign in to Arcloom" });
    expect(screen.getByLabelText("Email address")).toHaveFocus();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
  it("uses the secure login contract and clears the token after success", async () => {
    const session = {
      actor: { id: "owner", tenant: "lab", role: "admin" },
      csrf: "session-csrf",
    };
    request.mockResolvedValueOnce(session);
    const { authenticated, input } = openAccess();
    const token = "private-test-token-" + "x".repeat(40);
    fireEvent.change(input, { target: { value: token } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(authenticated).toHaveBeenCalledWith(session));
    expect(request).toHaveBeenCalledExactlyOnceWith("/api/auth/login", "POST", {
      token,
    });
    expect(input).toHaveValue("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it("announces failed access without entering the workspace", async () => {
    request.mockRejectedValueOnce(new Error("Access token not recognized."));
    const { authenticated, input } = openAccess();
    fireEvent.change(input, { target: { value: "unknown-" + "x".repeat(40) } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Access token not recognized.",
    );
    expect(authenticated).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Enter workspace" }),
    ).toBeEnabled();
  });
  it("lets keyboard users explore human checkpoints without executing real work", () => {
    render(<Landing authenticated={vi.fn()} />);
    const first = screen.getByRole("tab", { name: /Report/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("tab", { name: /Approve/ });
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Human execution approval",
    );
    fireEvent.keyDown(second, { key: "End" });
    expect(screen.getByRole("tab", { name: /Continue/ })).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "A new proposal needing fresh approval",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Decision journal" }),
    );
    expect(screen.getByText("The record keeps the whole story.")).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });
  it("provides a working mobile navigation menu and a safe session message", () => {
    render(
      <Landing
        authenticated={vi.fn()}
        statusMessage="Session expired. Sign in again."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Session expired.");
    const toggle = screen.getByRole("button", { name: "Open product menu" });
    fireEvent.click(toggle);
    const menu = screen.getByRole("navigation", {
      name: "Mobile product navigation",
    });
    expect(menu).toBeInTheDocument();
    fireEvent.click(menu.querySelector('a[href="#workflow"]')!);
    expect(
      screen.queryByRole("navigation", { name: "Mobile product navigation" }),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
  it("explains separate approvals and current prerequisites without mutating a workspace", () => {
    render(<Landing authenticated={vi.fn()} />);
    const review = screen.getByRole("button", {
      name: "Explore Human checkpoints",
    });
    review.focus();
    fireEvent.click(review);
    expect(review).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(/A human approves execution before a bounded test runs/),
    ).toBeVisible();
    fireEvent.keyDown(review, { key: "End" });
    expect(
      screen.getByRole("button", { name: "Explore Connected memory" }),
    ).toHaveFocus();
    expect(
      screen.getByText(
        /every prerequisite has current support at the active revision/,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Interactive illustration only. No tests run or workspace records are shown.",
      ),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });
});
