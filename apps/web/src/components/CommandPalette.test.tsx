// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalShowModal)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalShowModal,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
});
function open(canWrite = true) {
  const actions = {
    onNavigate: vi.fn(),
    onNewReport: vi.fn(),
    onClose: vi.fn(),
  };
  return {
    ...actions,
    ...render(<CommandPalette {...actions} canWrite={canWrite} />),
  };
}

describe("workspace command menu", () => {
  it("focuses search and opens matching navigation with Enter", () => {
    const actions = open();
    const search = screen.getByRole("combobox", {
      name: "Search workspace commands",
    });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "findings" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.keyDown(search, { key: "Enter" });
    expect(actions.onNavigate).toHaveBeenCalledWith("memory");
    expect(actions.onClose).toHaveBeenCalledOnce();
  });
  it("supports arrow selection and pointer activation", () => {
    const actions = open();
    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(
      screen.getByRole("option", { name: "Investigations" }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(actions.onNavigate).toHaveBeenCalledWith("investigations");
    fireEvent.click(
      screen.getByRole("option", { name: "Activity & evidence" }),
    );
    expect(actions.onNavigate).toHaveBeenLastCalledWith("activity");
  });
  it("does not expose report creation for a viewer or invoke an empty result", () => {
    const actions = open(false);
    expect(
      screen.queryByRole("option", { name: "New report" }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "New report" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("No commands match");
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(actions.onNewReport).not.toHaveBeenCalled();
    expect(actions.onClose).not.toHaveBeenCalled();
  });
  it("opens report creation for authorized users without submitting a report", () => {
    const actions = open();
    fireEvent.click(screen.getByRole("option", { name: "New report" }));
    expect(actions.onNewReport).toHaveBeenCalledOnce();
    expect(actions.onNavigate).not.toHaveBeenCalled();
    expect(actions.onClose).toHaveBeenCalledOnce();
  });
  it("dismisses with Escape and restores trigger focus on unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Open commands";
    document.body.append(trigger);
    trigger.focus();
    const actions = open();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(actions.onClose).toHaveBeenCalledOnce();
    actions.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
  it("contains tab focus within its close control and search field", () => {
    open();
    const close = screen.getByRole("button", { name: "Close command menu" });
    const search = screen.getByRole("combobox");
    fireEvent.keyDown(search, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(search).toHaveFocus();
  });
});
