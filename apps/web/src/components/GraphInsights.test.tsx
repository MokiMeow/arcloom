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
import { GraphInsights } from "./GraphInsights";
import { request } from "../api";
vi.mock("../api", () => ({ request: vi.fn(), errorText: String }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("keeps the selected finding fixed until its withdrawal analysis finishes", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(request).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(
    <GraphInsights
      nodes={[
        {
          id: "finding_a",
          kind: "Finding",
          props: { current: true, title: "Source A" },
        },
        {
          id: "finding_b",
          kind: "Finding",
          props: { current: true, title: "Source B" },
        },
      ]}
      selectNode={vi.fn()}
    />,
  );
  const root = screen.getByLabelText("Finding to withdraw");
  fireEvent.change(root, { target: { value: "finding_a" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Run withdrawal analysis" }),
  );
  expect(root).toBeDisabled();
  await act(async () =>
    finish({
      revision: "r1",
      supported_before: 1,
      supported_after: 0,
      lost_support: 1,
      paths: [],
      tests: [],
      queries: {},
      assumptions: [],
    }),
  );
  expect(root).toBeEnabled();
});
