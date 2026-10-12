import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

// Use a preinstalled Chromium when present (CI/cloud); otherwise `npx playwright install chromium`.
const preinstalled = "/opt/pw-browsers/chromium";
const executablePath = process.env.PW_CHROMIUM_PATH ?? (fs.existsSync(preinstalled) ? preinstalled : undefined);
const PORT = 3123;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `rm -rf .e2e-data && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MOCK_AI: "1", MOCK_EXTERNAL: "1", DATA_DIR: ".e2e-data", E2E: "1" },
  },
});
