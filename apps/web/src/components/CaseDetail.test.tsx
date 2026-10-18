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
import { CaseDetail } from "./CaseDetail";
import { request } from "../api";

vi.mock("../api", () => ({
  request: vi.fn(),
  errorText: String,
  useRemote: () => ({
    loading: false,
    error: null,
    data: {
      id: "case_source",
      title: "Reviewed source",
      origin: "report",
      asset_id: "gateway",
      revision: "r1",
      state: "confirmed",
      researcher: "Test researcher",
      reason: "Source evidence",
      created_at: 1,
      path: [],
      supports: [],
      runs: [],
      finding: { id: "finding_source" },
    },
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("does not reopen a case after the reviewer leaves during discovery", async () => {
  let finish!: (value: { case_id: string }) => void;
  vi.mocked(request).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const openCase = vi.fn();
  const changed = vi.fn();
  const view = render(
    <CaseDetail
      id="case_source"
      revision={0}
      back={vi.fn()}
      changed={changed}
      openCase={openCase}
      role="admin"
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Investigate connected paths" }),
  );
  view.unmount();
  await act(async () => finish({ case_id: "case_later" }));
  expect(openCase).not.toHaveBeenCalled();
  expect(changed).toHaveBeenCalledOnce();
});
