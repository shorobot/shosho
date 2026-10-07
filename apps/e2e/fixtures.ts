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
      await page.goto("/login");
      await page.getByLabel("E-Mail").fill(STAFF[role].email);
      await page.getByLabel("Passwort").fill(PASSWORD);
      await page.getByRole("button", { name: "Anmelden" }).click();
    });
  },
});

export { expect } from "@playwright/test";
export { STAFF, type StaffRole } from "./helpers/db";
