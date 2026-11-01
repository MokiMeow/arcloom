import { expect, it } from "vitest";
import { passwordProblem } from "./AccountFields";

it("matches the server's Unicode character limits without trimming password spaces", () => {
  expect(passwordProblem("  a private passphrase  ")).toBeNull();
  expect(passwordProblem("🙂".repeat(128))).toBeNull();
  expect(passwordProblem("🙂".repeat(11))).toMatch(/between 12 and 128/);
  expect(passwordProblem("🙂".repeat(129))).toMatch(/between 12 and 128/);
});

it("rejects prohibited control characters and malformed Unicode without changing allowed Unicode", () => {
  expect(passwordProblem("private\npassphrase")).toMatch(/control characters/);
  expect(passwordProblem("private\u007fpassphrase")).toMatch(
    /control characters/,
  );
  expect(passwordProblem("private\ud800passphrase")).toMatch(/valid Unicode/);
  expect(passwordProblem("\u0085".repeat(12))).toBeNull();
});
