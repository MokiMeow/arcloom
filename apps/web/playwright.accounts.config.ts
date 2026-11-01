import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// A fresh disposable API/lab run keeps authentication rate-limit tests separate
// from the workspace suite without changing production admission limits.
export default defineConfig({
  ...base,
  testDir: "./e2e-accounts",
  outputDir: "test-results/accounts",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/accounts-results.json" }],
  ],
});
