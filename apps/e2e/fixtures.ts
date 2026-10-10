import { test as base, type Page } from "@playwright/test";
import { anon, PASSWORD, signInAs, STAFF, type Db, type StaffRole } from "./helpers/db";

export const WEB_URL = process.env.WEB_URL ?? "http://127.0.0.1:3100";
export const BO_URL = process.env.BO_URL ?? "http://127.0.0.1:3102";

type Fixtures = {
  /** A page pointed at apps/web (the guest site). */
  webPage: Page;
  /** A page pointed at apps/backoffice, not signed in yet — call signInBackoffice(boPage, role) first. */
  boPage: Page;
  /**
   * A real `owner` staff session (anon key + password auth) — NOT the service-role key, which the boot
   * forbids anywhere in this suite. Owner has full read/write on everything these specs touch, so RLS
   * guards setup/assertion steps exactly as it would a human owner. Use `signInAs("operator"|…)` from
   * helpers/db.ts directly when a test needs a narrower role's own view instead.
   */
  db: Db;
  /** Anon-key client — for raw RPC probes that bypass the UI on purpose (money-consistency, auth spot checks). */
  anonDb: Db;
  signInBackoffice: (page: Page, role: StaffRole) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  webPage: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: WEB_URL });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  boPage: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: BO_URL });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  // eslint-disable-next-line no-empty-pattern
  db: async ({}, use) => {
    await use(await signInAs("owner"));
  },
  // eslint-disable-next-line no-empty-pattern
  anonDb: async ({}, use) => {
    await use(anon());
  },
  // eslint-disable-next-line no-empty-pattern
  signInBackoffice: async ({}, use) => {
    await use(async (page, role) => {
      // LoginForm.tsx's <form onSubmit={...}> does call e.preventDefault() first thing — correct code —
      // but on a cold `next dev` compile (every CI run's first hit) there's a real window between the
      // SSR'd <form> painting and React attaching that handler. A click inside that window falls through
      // to the browser's native submission, which for a method-less form is GET: every field, including
      // the password, lands in the URL (`/login?email=...&password=...`) — seen once in this boot's own
      // CI run. Wait out hydration, then retry once if the symptom still shows (defense in depth, not
      // a claim this is likely in production — see the S6-02-S4 proposal for the one-line hardening fix).
      async function attempt() {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.getByLabel("E-Mail").fill(STAFF[role].email);
        await page.getByLabel("Passwort").fill(PASSWORD);
        await page.getByRole("button", { name: "Anmelden" }).click();
      }
      await attempt();
      if (page.url().includes("?email=")) {
        await attempt();
      }
    });
  },
});

export { expect } from "@playwright/test";
export { STAFF, type StaffRole } from "./helpers/db";

/**
 * Dismiss the cookie consent bar (apps/web/components/site/CookieBanner.tsx) if it shows, without
 * hard-failing the test if it doesn't.
 *
 * CI finding, not yet root-caused (see memory/log.md's S6-01 entry): against a FRESH local Supabase
 * seed in the `e2e` CI job, the banner never appeared at all — `settings.site.cookie_banner` is `true`
 * in seed.sql and RLS exposes the `site` key to anon unchanged across every migration, so the data path
 * looks correct by inspection; against live `shosho-staging` (manually driven in a real browser during
 * this boot) the exact same banner appeared and dismissed normally. The gap is real and reproducible in
 * CI but unexplained — flagged to S3 rather than guessed at further. This suite only needs the banner
 * gone so later clicks aren't intercepted by its fixed overlay; it does not need to prove why.
 */
export async function dismissCookieBanner(page: Page): Promise<void> {
  const ok = page.getByRole("button", { name: "OK" });
  try {
    await ok.waitFor({ state: "visible", timeout: 5_000 });
    await ok.click();
  } catch {
    // not shown — proceed; see the comment above.
  }
}
