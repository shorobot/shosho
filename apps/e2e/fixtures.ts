import { expect, test as base, type Page } from "@playwright/test";
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

/**
 * Root cause of every CI failure in this suite, found by reading the trace's own `pageError` events
 * (see memory/log.md's S6-01 entry): both apps' CSP (`apps/web/lib/csp.ts` and
 * `apps/backoffice/lib/csp.ts`) sets `script-src 'self' 'nonce-…' 'strict-dynamic'` with no
 * `'unsafe-eval'` and no development-mode carve-out. `next dev`'s webpack HMR runtime evaluates chunks
 * via `eval()`, which that CSP then blocks outright — every page load throws
 * `EvalError: Content Security Policy... 'unsafe-eval' is not an allowed source`, and the app is 100%
 * non-interactive: clicks land (`:active` fires, it's a real DOM click) but no handler ever runs,
 * because the JS that would attach one never finished evaluating. `next build`/`next start` (what
 * staging actually runs) doesn't use `eval()`, so this is invisible there — confirmed live on
 * `shosho-staging` in this same boot. This is a real product bug (any local `pnpm dev` run of either
 * app is broken this way, not just this CI job), filed as the top finding. Worked around here, not
 * fixed — `apps/web`/`apps/backoffice` are outside this boot's boundary — by stripping the CSP header
 * from the document response for the two dev servers this suite drives, which only removes a
 * restriction `next dev` itself never needed until this policy was added.
 */
async function relaxDevCsp(context: import("@playwright/test").BrowserContext): Promise<void> {
  await context.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    const headers = response.headers();
    delete headers["content-security-policy"];
    delete headers["content-security-policy-report-only"];
    await route.fulfill({ response, headers });
  });
}

export const test = base.extend<Fixtures>({
  webPage: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: WEB_URL });
    await relaxDevCsp(context);
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  boPage: async ({ browser }, use) => {
    const context = await browser.newContext({ baseURL: BO_URL });
    await relaxDevCsp(context);
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
      // but under this CI runner's load (two `next dev` servers + local Supabase + the browser, all on
      // one box) there's a real, repeatable window between the SSR'd <form> painting and React actually
      // attaching that handler — `networkidle` (no network activity) is not the same guarantee as
      // "hydrated" (JS parsed and executed), and this boot's own CI runs hit the gap on more than one
      // attempt. A click inside that window falls through to the browser's native submission, which for
      // a method-less form is GET: every field, including the password, lands in the URL
      // (`/login?email=...&password=...`) — the S6-02-S4 proposal has the one-line product fix. Retry a
      // few times with a short settle delay rather than once — this is a timing race, not a one-off.
      for (let i = 0; i < 4; i++) {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500); // settle buffer past "network idle" ≠ "hydrated"
        await page.getByLabel("E-Mail").fill(STAFF[role].email);
        await page.getByLabel("Passwort").fill(PASSWORD);
        await page.getByRole("button", { name: "Anmelden" }).click();
        await page.waitForTimeout(300);
        if (!page.url().includes("?email=")) return;
      }
      throw new Error(`signInBackoffice(${role}): still hitting the login-form GET-submission race after 4 attempts`);
    });
  },
});

export { expect } from "@playwright/test";
export { STAFF, type StaffRole } from "./helpers/db";

/**
 * Call right after every `webPage.goto("/…")`, before the first click: waits for the page to actually
 * be interactive, then dismisses the cookie consent bar if it shows.
 *
 * Both halves trace back to the same CI-only symptom (see memory/log.md's S6-01 entry, finding #6):
 * hydration on `apps/web` taking long enough under this CI runner's load (two `next dev` servers + a
 * local Supabase stack + the Playwright browser, all sharing one constrained box) that an action fired
 * right after `goto()` can land before React has attached anything — not just the cookie banner's
 * `useEffect` never getting a chance to run, but an "Add" button click on the home page doing nothing
 * because its own handler isn't live yet, silently leaving the cart empty for the rest of the test.
 * `networkidle` is the honest wait for that, not a guess at a fixed delay — and the cookie banner was
 * never independently root-caused beyond this.
 */
export async function dismissCookieBanner(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  const ok = page.getByRole("button", { name: "OK" });
  try {
    await ok.waitFor({ state: "visible", timeout: 5_000 });
    await ok.click();
  } catch {
    // not shown — proceed; see the comment above.
  }
}

/**
 * Click the home page's "Add <item>" button `times` times and wait for the cart to actually register
 * it before returning — do not just click and immediately `goto("/checkout")`.
 *
 * apps/web/lib/cart.tsx persists to localStorage (key "shosho.cart.v1") in a `useEffect` gated on
 * `hydrated` — a passive effect that runs *after* the render commits, not synchronously with the click.
 * Every CI run in this boot that clicked "Add" and immediately `goto()`'d to `/checkout` (a full
 * navigation, so the whole React tree including CartProvider remounts) showed "0 positions" — the
 * navigation's own unload was winning the race against the effect's write. Polling `localStorage`
 * directly is what actually proves the write landed — Header.tsx's own cart-count link turned out to be
 * `md:hidden` (mobile-only; a wrong first attempt at this fix, caught by run 5 timing out waiting on an
 * element that is never visible in this suite's desktop viewport, not by the write itself being slow).
 */
export async function addToCartFromHome(page: Page, itemName: string, times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await page.getByRole("button", { name: `Add ${itemName}` }).click();
  }
  await expect
    .poll(() => page.evaluate(() => { try { return (JSON.parse(localStorage.getItem("shosho.cart.v1") ?? "null")?.lines ?? []).reduce((n: number, l: { qty: number }) => n + l.qty, 0); } catch { return 0; } }))
    .toBe(times);
}
