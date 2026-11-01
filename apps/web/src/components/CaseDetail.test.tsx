// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CaseDetail } from "./CaseDetail";
import { request } from "../api";
import type { Case, CaseState, Outcome, Run } from "../types";

const remote = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("../api", () => ({
  request: vi.fn(),
  errorText: String,
  useRemote: () => ({ loading: false, error: null, data: remote.data }),
}));

function run(id: string, outcome: Outcome): Run {
  return {
    id,
    outcome,
    evidence_hash: `hash_${id}`,
    revision: "r1",
    created_at: 2,
    receipt: {
      run_id: id,
      case_id: "case_source",
      test_id: "gateway-boundary",
      tenant: "test",
      revision: "r1",
      outcome,
      conclusion: `Recorded ${outcome} observation for ${id}.`,
      observations: [],
      request_count: 1,
      environment: "synthetic-asgi-lab",
      signature: "unit-test-signature",
      synthetic: true,
    },
  };
}

function sourceCase(): Case {
  return {
    id: "case_source",
    title: "Reviewed source",
    test_id: "gateway-boundary",
    origin: "report",
    asset_id: "gateway",
    revision: "r1",
    state: "confirmed",
    researcher: "Test researcher",
    reason: "Source evidence",
    created_at: 1,
    updated_at: 3,
    depth: 0,
    stale: false,
    path: [],
    supports: [],
    runs: [run("run_source", "reproduced")],
    approvals: [
      {
        id: "approval_source",
        reason: "The bounded test is authorized.",
        decision: "approve",
        actor: "reviewer_source",
      },
    ],
    reviews: [
      {
        id: "review_source",
        run_id: "run_source",
        reason: "The recorded evidence was inspected.",
        decision: "accept",
        actor: "reviewer_source",
      },
    ],
    finding: {
      id: "finding_source",
      title: "Reviewed source",
      case_id: "case_source",
      test_id: "gateway-boundary",
      revision: "r1",
      current: true,
      researcher: "Test researcher",
      supports: [],
      depth: 0,
    },
  };
}

function renderCase() {
  return render(
    <CaseDetail
      id="case_source"
      revision={0}
      back={vi.fn()}
      changed={vi.fn()}
      openCase={vi.fn()}
      role="admin"
    />,
  );
}

function stage(label: string) {
  return within(screen.getByRole("list", { name: "Investigation stages" }))
    .getByText(label, { exact: true })
    .closest("li")!;
}

beforeEach(() => {
  remote.data = sourceCase();
});
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

it.each<[CaseState, string]>([
  ["awaiting_approval", "This attempt needs a new execution approval."],
  ["queued", "The newly approved attempt is queued."],
  ["running", "The current attempt is running in the lab."],
])(
  "keeps retained evidence separate from a %s retry's pending stages",
  (state, pending) => {
    const previous = run("run_previous", "inconclusive");
    remote.data = {
      ...sourceCase(),
      state,
      finding: null,
      runs: [previous],
      reviews: [
        {
          id: "review_previous",
          run_id: previous.id,
          reason: "The prior observation was inconclusive.",
          decision: "needs_info",
          actor: "reviewer_source",
        },
      ],
    };
    renderCase();
    expect(stage("Runner observation")).not.toHaveClass(
      "case-progress-complete",
    );
    expect(stage("Evidence review")).toHaveClass("case-progress-waiting");
    expect(stage("Evidence review")).toHaveTextContent(
      "Waiting for a new observation",
    );
    expect(
      screen.getByText("Previous-attempt evidence", { exact: true }),
    ).toBeVisible();
    expect(screen.getByText(previous.receipt.conclusion)).toBeVisible();
    expect(screen.getByText(pending, { exact: true })).toBeVisible();
    if (state === "awaiting_approval") {
      expect(stage("Execution approval")).toHaveAttribute(
        "aria-current",
        "step",
      );
      expect(stage("Execution approval")).toHaveTextContent("Needs a reviewer");
      expect(stage("Runner observation")).toHaveClass("case-progress-waiting");
    } else {
      expect(stage("Runner observation")).toHaveAttribute(
        "aria-current",
        "step",
      );
      expect(stage("Runner observation")).toHaveTextContent(
        state === "queued" ? "Queued" : "Running in lab",
      );
    }
  },
);

it("requires a new evidence review after a retry records a new run", () => {
  const previous = run("run_previous", "inconclusive");
  const latest = run("run_latest", "not_reproduced");
  remote.data = {
    ...sourceCase(),
    state: "awaiting_review",
    finding: null,
    runs: [previous, latest],
    reviews: [
      {
        id: "review_previous",
        run_id: previous.id,
        reason: "The prior observation was inconclusive.",
        decision: "accept",
        actor: "reviewer_source",
      },
    ],
  };
  renderCase();
  expect(stage("Runner observation")).toHaveClass("case-progress-complete");
  expect(stage("Evidence review")).toHaveClass("case-progress-current");
  expect(stage("Evidence review")).toHaveTextContent("Needs a reviewer");
  expect(screen.queryByText("Previous-attempt evidence")).toBeNull();
  expect(screen.getByText(latest.receipt.conclusion)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Accept recorded outcome" }),
  ).toBeDisabled();
});

it.each<[CaseState, Outcome]>([
  ["not_reproduced", "not_reproduced"],
  ["inconclusive", "inconclusive"],
])(
  "shows an accepted %s outcome as reviewed without declaring a finding",
  (state, outcome) => {
    const observation = run("run_negative", outcome);
    remote.data = {
      ...sourceCase(),
      state,
      finding: null,
      runs: [observation],
      reviews: [
        {
          id: "review_negative",
          run_id: observation.id,
          reason: "The non-positive evidence was reviewed and retained.",
          decision: "accept",
          actor: "reviewer_source",
        },
      ],
    };
    renderCase();
    expect(stage("Evidence review")).toHaveClass("case-progress-complete");
    expect(stage("Evidence review")).toHaveTextContent("Outcome accepted");
    expect(screen.getByText(observation.receipt.conclusion)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Investigate connected paths" }),
    ).toBeNull();
    expect(screen.queryByText("Confirmed", { exact: true })).toBeNull();
  },
);

it.each([undefined, "run_older"])(
  "does not mark a terminal run reviewed from an unlinked review (%s)",
  (runId) => {
    remote.data = {
      ...sourceCase(),
      state: "inconclusive",
      finding: null,
      runs: [run("run_latest", "inconclusive")],
      reviews: [
        {
          id: "review_old",
          ...(runId ? { run_id: runId } : {}),
          reason:
            "A legacy or earlier-attempt review must not complete this run.",
          decision: "accept",
          actor: "reviewer_source",
        },
      ],
    };
    renderCase();
    expect(stage("Evidence review")).toHaveClass("case-progress-waiting");
    expect(stage("Evidence review")).toHaveTextContent("Not reviewed");
  },
);

it("retains complete case, run, reviewer and artifact identifiers without replacing suffixes", async () => {
  const value = sourceCase();
  const caseId = `case_${"12345678".repeat(8)}_remaining_case_suffix`;
  const runId = `run_${"87654321".repeat(8)}_remaining_run_suffix`;
  const reviewerId = `member_${"reviewer".repeat(8)}_remaining_actor_suffix`;
  const hash = "0123456789abcdef".repeat(4);
  const observation = { ...run(runId, "reproduced"), evidence_hash: hash };
  remote.data = {
    ...value,
    id: caseId,
    runs: [observation],
    reviews: [{ ...value.reviews![0], actor: reviewerId, run_id: runId }],
  };
  renderCase();
  for (const identifier of [caseId, runId, reviewerId, hash]) {
    expect(
      screen
        .getAllByText(identifier, { exact: true })
        .some((element) => element.classList.contains("full-identifier-value")),
    ).toBe(true);
  }
  vi.mocked(request).mockResolvedValue({});
  fireEvent.click(
    screen.getByRole("button", { name: "Verify evidence integrity" }),
  );
  await screen.findByText("Integrity verified against stored bytes");
  expect(request).toHaveBeenCalledWith(`/api/evidence/${hash}`);
});
