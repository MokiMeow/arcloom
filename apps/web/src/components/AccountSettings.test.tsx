// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { AccountSettings } from "./AccountSettings";
import { request } from "../api";

vi.mock("../api", () => ({ request: vi.fn(), errorText: String }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const actor = {
  id: "account_one",
  tenant: "workspace_private",
  role: "admin" as const,
  name: "Casey",
  email: "casey@example.com",
  password_account: true,
};
const password = "  a new private passphrase  ";

it("shows current account identity and renews the parent session after an authorized password change", async () => {
  const session = { actor, csrf: "renewed-session-csrf" };
  vi.mocked(request).mockResolvedValueOnce(session);
  const update = vi.fn();
  render(<AccountSettings actor={actor} onSessionUpdated={update} />);
  expect(screen.getByText(actor.id)).toBeVisible();
  expect(screen.getByText(actor.email)).toBeVisible();
  expect(screen.getByText(actor.name)).toBeVisible();
  fireEvent.click(screen.getByText("Change password", { exact: true }));
  fireEvent.change(screen.getByLabelText("Current password", { exact: true }), {
    target: { value: "current private password" },
  });
  fireEvent.change(screen.getByLabelText("New password", { exact: true }), {
    target: { value: password },
  });
  fireEvent.change(
    screen.getByLabelText("Confirm new password", { exact: true }),
    { target: { value: password } },
  );
  fireEvent.submit(
    screen.getByLabelText("Current password", { exact: true }).closest("form")!,
  );
  await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith(session));
  expect(request).toHaveBeenCalledExactlyOnceWith(
    "/api/auth/password",
    "POST",
    { current_password: "current private password", new_password: password },
  );
  expect(
    screen.getByLabelText("Current password", { exact: true }),
  ).toHaveValue("");
  expect(screen.getByLabelText("New password", { exact: true })).toHaveValue(
    "",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Your current session has been renewed",
  );
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it("validates the new password and confirmation without changing a session", () => {
  const update = vi.fn();
  render(<AccountSettings actor={actor} onSessionUpdated={update} />);
  fireEvent.click(screen.getByText("Change password", { exact: true }));
  fireEvent.change(screen.getByLabelText("Current password", { exact: true }), {
    target: { value: "current private password" },
  });
  fireEvent.change(screen.getByLabelText("New password", { exact: true }), {
    target: { value: password },
  });
  fireEvent.change(
    screen.getByLabelText("Confirm new password", { exact: true }),
    { target: { value: "some other private password" } },
  );
  fireEvent.submit(
    screen.getByLabelText("Current password", { exact: true }).closest("form")!,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("passwords do not match");
  expect(request).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

it("does not offer email password changes to a token-only member", () => {
  render(
    <AccountSettings
      actor={{ id: "member_viewer", tenant: "workspace", role: "viewer" }}
      onSessionUpdated={vi.fn()}
    />,
  );
  expect(
    screen.getByText(/You signed in with a workspace access token/),
  ).toBeVisible();
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});
