import { defineConfig, devices } from "@playwright/test";

// Smoke test against a real Supabase (local stack or `shosho-staging`) — it signs in with the seed
// staff logins, so it cannot run in the `node (backoffice)` CI job (PR jobs never see the staging
// secrets, and a local stack needs Docker). Run it locally: see README → "End-to-end smoke".
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3101);

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "list" : "html",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
