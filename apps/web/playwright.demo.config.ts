import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-demo",
  timeout: 60000,
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4174", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build:demo && npm run preview:demo -- --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
