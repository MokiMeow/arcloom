// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DecisionReceipt } from "./DecisionReceipt";
afterEach(cleanup);
describe("decision receipts preserve uncertainty", () => {
  it("never shows an absent receipt as a completed model call", () => {
    render(<DecisionReceipt />);
    expect(
      screen.queryByText("Inspect Cloudflare decision receipt"),
    ).toBeNull();
  });
  it("separates choice probabilities from vulnerability proof", () => {
    render(
      <DecisionReceipt
        decision={{
          model: "@cf/cloudflare/clef",
          outcome: "needs_review",
          choice: "abstain",
          probabilities: { abstain: 0.9, test: 0.1 },
          confidence: 0.8,
          margin: 0.8,
          caution_probability: 0.7,
          latency_ms: 240,
          estimated_model_cost_usd: 0.00006,
          input_sha256: "fixture",
          calibrated_on_arcloom: false,
        }}
      />,
    );
    expect(
      screen.getByText(/not a probability that a vulnerability exists/),
    ).toBeInTheDocument();
    expect(screen.getByText(/needs review/)).toBeInTheDocument();
    expect(screen.getByText("90.0%")).toBeInTheDocument();
  });
});
