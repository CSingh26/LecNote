import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "milestone5.spec.ts",
  outputDir: "../../test-results/milestone5",
  timeout: 30000,
  fullyParallel: false,
  use: {
    baseURL: "http://127.0.0.1:5187",
    headless: true,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  },
  reporter: "list",
});
