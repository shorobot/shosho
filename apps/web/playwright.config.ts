import { defineConfig, devices } from "@playwright/test";

// Smoke e2e against the dev server with the mock API (no Supabase needed):
//   pnpm --filter @shosho/web exec playwright install chromium && pnpm --filter @shosho/web test:e2e
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 } } },
  ],
  webServer: {
    command: "NEXT_PUBLIC_API=mock pnpm dev --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
