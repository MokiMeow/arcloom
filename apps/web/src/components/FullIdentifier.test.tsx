// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { FullIdentifier } from "./FullIdentifier";
const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(navigator, "clipboard", original);
  else Reflect.deleteProperty(navigator, "clipboard");
});
function clipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value });
}
const identifier = `case_${"abcd1234".repeat(8)}_additional_namespace_suffix`;
it("renders every part of a long identifier and copies the exact value", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  clipboard({ writeText });
  render(<FullIdentifier value={identifier} label="investigation ID" />);
  expect(screen.getByText(identifier)).toHaveClass("full-identifier-value");
  fireEvent.click(
    screen.getByRole("button", { name: "Copy investigation ID" }),
  );
  expect(
    await screen.findByText("investigation ID copied in full."),
  ).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(identifier);
});
it.each([undefined, { writeText: () => Promise.reject(new Error("Denied")) }])(
  "provides a focused, selected manual-copy field when clipboard access fails (%s)",
  async (value) => {
    clipboard(value);
    render(<FullIdentifier value={identifier} label="record ID" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy record ID" }));
    const field = await screen.findByRole("textbox", {
      name: "record ID for manual copy",
    });
    expect(field).toHaveValue(identifier);
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("readonly");
    expect((field as HTMLTextAreaElement).selectionStart).toBe(0);
    expect((field as HTMLTextAreaElement).selectionEnd).toBe(identifier.length);
  },
);
it("does not claim an old identifier was copied when the selected record changes during clipboard work", async () => {
  let finish!: () => void;
  clipboard({
    writeText: () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  });
  const { rerender } = render(
    <FullIdentifier value={identifier} label="record ID" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Copy record ID" }));
  rerender(<FullIdentifier value="record_new_selection" label="record ID" />);
  await act(async () => finish());
  expect(screen.queryByText("Copied")).toBeNull();
  expect(screen.getByText("record_new_selection")).toBeInTheDocument();
});
