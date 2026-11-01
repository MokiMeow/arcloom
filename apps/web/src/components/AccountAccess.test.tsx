// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import { AccountAccess } from "./AccountAccess";
import { request } from "../api";

vi.mock("../api", () => ({ request: vi.fn(), errorText: String }));
const session = {
  actor: {
    id: "account_one",
    tenant: "private_workspace_one",
    role: "admin",
    name: "Casey Researcher",
    email: "casey@example.com",
    password_account: true,
  },
  csrf: "new-session-csrf",
};
const password = "  a private passphrase  ";
const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
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
  vi.unstubAllGlobals();
  if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});

function open() {
  const authenticated = vi.fn();
  const close = vi.fn();
  render(<AccountAccess authenticated={authenticated} close={close} />);
  return { authenticated, close };
}
function registerFields() {
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  fireEvent.change(screen.getByLabelText("Your name"), {
    target: { value: "Casey Researcher" },
  });
  fireEvent.change(screen.getByLabelText("Email address"), {
    target: { value: "casey@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password", { exact: true }), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirm password", { exact: true }), {
    target: { value: password },
  });
}

describe("individual account access", () => {
  it("focuses the committed mode immediately without stealing later field input", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByLabelText("Your name")).toHaveFocus();
    const email = screen.getByLabelText("Email address");
    email.focus();
    fireEvent.change(email, { target: { value: "casey@example.com" } });
    expect(email).toHaveFocus();
    expect(screen.getByLabelText("Your name")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(email).toHaveFocus();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset account access" }),
    );
    expect(screen.getByLabelText("Email address")).toHaveFocus();
  });
  it("starts with an email/password form, supports explicit password reveal and preserves password spaces", async () => {
    vi.mocked(request).mockResolvedValueOnce(session);
    const { authenticated } = open();
    expect(
      screen.getByRole("dialog", { name: "Sign in to Arcloom" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Email address" }),
    ).toHaveFocus();
    const field = screen.getByLabelText("Password", { exact: true });
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "current-password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "casey@example.com" },
    });
    fireEvent.change(field, { target: { value: password } });
    fireEvent.submit(field.closest("form")!);
    await waitFor(() =>
      expect(authenticated).toHaveBeenCalledExactlyOnceWith(session),
    );
    expect(request).toHaveBeenCalledExactlyOnceWith("/api/auth/login", "POST", {
      email: "casey@example.com",
      password,
    });
    expect(field).toHaveValue("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("rejects mismatched registration passwords before any request", () => {
    open();
    registerFields();
    fireEvent.change(
      screen.getByLabelText("Confirm password", { exact: true }),
      { target: { value: "a different passphrase" } },
    );
    fireEvent.submit(
      screen.getByLabelText("Password", { exact: true }).closest("form")!,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "passwords do not match",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("requires an explicit recovery-code decision after registration and offers a private download", async () => {
    const code = "once-only-recovery-code";
    vi.mocked(request).mockResolvedValueOnce({
      ...session,
      recovery_code: code,
    });
    const { authenticated, close } = open();
    registerFields();
    fireEvent.submit(
      screen.getByLabelText("Password", { exact: true }).closest("form")!,
    );
    expect(
      await screen.findByRole("dialog", { name: "Save your recovery code" }),
    ).toBeVisible();
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/auth/register",
      "POST",
      { name: "Casey Researcher", email: "casey@example.com", password },
    );
    expect(screen.getByLabelText("Your recovery code")).toHaveValue(code);
    expect(authenticated).not.toHaveBeenCalled();
    const enter = screen.getByRole("button", {
      name: "Enter workspace",
    });
    expect(enter).toBeDisabled();
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Save your recovery code",
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy recovery code" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Select and copy the recovery code manually",
    );
    let downloaded: NodeBlob | undefined;
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("URL", {
      createObjectURL: (blob: NodeBlob) => {
        downloaded = blob;
        return "blob:recovery";
      },
      revokeObjectURL: vi.fn(),
    });
    fireEvent.click(screen.getByRole("button", { name: "Download code" }));
    expect(click).toHaveBeenCalledOnce();
    expect(await downloaded!.text()).toContain(code);
    expect(await downloaded!.text()).not.toContain(password);
    expect(authenticated).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I saved this recovery code somewhere safe.",
      }),
    );
    fireEvent.click(enter);
    expect(authenticated).toHaveBeenCalledExactlyOnceWith(session);
    expect(
      screen.queryByLabelText("Your recovery code"),
    ).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    click.mockRestore();
  });

  it("recovers access with the saved code and requires acknowledgement of its replacement", async () => {
    vi.mocked(request).mockResolvedValueOnce({
      ...session,
      recovery_code: "replacement-code",
    });
    const { authenticated } = open();
    fireEvent.click(
      screen.getByRole("button", { name: "Reset account access" }),
    );
    expect(screen.getByText(/No reset email will be sent/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "casey@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Saved recovery code"), {
      target: { value: "saved-code" },
    });
    fireEvent.change(screen.getByLabelText("New password", { exact: true }), {
      target: { value: password },
    });
    fireEvent.change(
      screen.getByLabelText("Confirm password", { exact: true }),
      { target: { value: password } },
    );
    fireEvent.submit(
      screen.getByLabelText("New password", { exact: true }).closest("form")!,
    );
    expect(await screen.findByLabelText("Your recovery code")).toHaveValue(
      "replacement-code",
    );
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "/api/auth/recover",
      "POST",
      {
        email: "casey@example.com",
        recovery_code: "saved-code",
        new_password: password,
      },
    );
    expect(authenticated).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Continue without saving",
      }),
    );
    expect(
      screen.getByText(/you may be unable to recover access/),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Enter without saving the code" }),
    );
    expect(authenticated).toHaveBeenCalledExactlyOnceWith(session);
  });

  it("keeps legacy workspace token access explicit and compatible", async () => {
    vi.mocked(request).mockResolvedValueOnce(session);
    const { authenticated } = open();
    fireEvent.click(
      screen.getByText("Advanced workspace token access", { exact: true }),
    );
    const token = "legacy-workspace-token-" + "t".repeat(32);
    const input = screen.getByLabelText("Workspace access token");
    fireEvent.change(input, { target: { value: token } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(authenticated).toHaveBeenCalledWith(session));
    expect(request).toHaveBeenCalledExactlyOnceWith("/api/auth/login", "POST", {
      token,
    });
    expect(input).toHaveValue("");
  });

  it("announces failed login and prevents duplicate requests while waiting", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(request).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    const { authenticated } = open();
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "casey@example.com" },
    });
    const input = screen.getByLabelText("Password", { exact: true });
    fireEvent.change(input, { target: { value: password } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    expect(request).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Please wait…" })).toBeDisabled();
    await act(async () =>
      fail(new Error("Account credentials not recognized.")),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Account credentials not recognized",
    );
    expect(authenticated).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Sign in with email" }),
    ).toBeEnabled();
  });
});
