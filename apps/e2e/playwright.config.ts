import { defineConfig, devices } from "@playwright/test";

// S6-01: cross-app suite. Unlike apps/web/e2e (mock API only) and apps/backoffice/e2e (real Supabase,
// single app), this drives BOTH apps against ONE Supabase so a guest order placed on apps/web can be
// found and driven on apps/backoffice's board, with the tracking page watching it update live. See
// apps/e2e/README.md for the two ways to point it at a stack: local (CI default) or staging (manual).
const WEB_PORT = 3100;
const BO_PORT = 3102; // apps/backoffice/e2e already defaults to 3101 — stay out of its way if both run

export default defineConfig({
  testDir: "./specs",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "html",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  // Both dev servers inherit this process's env — NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY must already be
  // set (the README's local recipe reads them from `supabase status -o env`).
  webServer: [
    {
      command: `pnpm --filter @shosho/web exec next dev --port ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `pnpm --filter @shosho/backoffice exec next dev --port ${BO_PORT}`,
      url: `http://127.0.0.1:${BO_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
