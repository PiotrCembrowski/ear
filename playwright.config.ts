import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke tests for the main flows, in Chromium with a FAKE
 * microphone that plays a generated WAV file (see tests/e2e/global-setup.ts).
 *
 *   npm run test:e2e
 *
 * The app is built and started against a placeholder Supabase URL: these
 * tests cover signed-out flows only (the Listen screen works without an account).
 */
const PORT = 3200;
export const FAKE_MIC_WAV = path.resolve("tests/e2e/.generated/fake-mic.wav");

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_placeholder_for_e2e_tests",
      NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`,
      SUPABASE_SECRET_KEY: "sb_secret_placeholder_for_e2e_tests_only",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream", // auto-accept the permission prompt
            "--use-fake-device-for-media-stream",
            `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
          ],
        },
      },
    },
  ],
});
