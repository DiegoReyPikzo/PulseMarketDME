import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e/browser",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: ".playwright-e2e/results",
  use: {
    baseURL:
      process.env.PULSEMARKET_E2E_BASE_URL ?? "http://127.0.0.1:4317",
    browserName: "chromium",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
