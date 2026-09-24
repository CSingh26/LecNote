import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 45000,
  fullyParallel: false,
  use: {
    baseURL: process.env.LECNOTE_TEST_URL || "http://127.0.0.1:4175",
    headless: true,
    reducedMotion: "reduce",
    launchOptions: {
      args: [
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
    },
    permissions: ["microphone"],
  },
  reporter: "list",
  webServer: process.env.LECNOTE_TEST_URL
    ? undefined
    : {
        command: "npm run dev -- --port 4175 --strictPort",
        url: "http://127.0.0.1:4175",
        reuseExistingServer: false,
      },
});
