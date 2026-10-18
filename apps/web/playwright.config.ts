import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: "http://127.0.0.1:8000",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `"${process.env.ARCLOOM_TEST_PYTHON ?? "python"}" scripts/e2e_server.py`,
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { PYTHONPATH: "src" },
    url: "http://127.0.0.1:8000/health/ready",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
