import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, signIn, type Db } from "./helpers";

beforeAll(openAllDay);

// ---------------------------------------------------------------------------------------------
// Function grants sweep (S7-01 task 2) — the regression test for the S2-02 finding: Supabase's
// default privileges grant EXECUTE on every new `public` function to `anon` and `authenticated`,
// regardless of `revoke … from public` (migration 18's own comment explains this). A migration
// that adds a function without an explicit, matching revoke silently re-opens that hole. This
// test does not trust migration history — it asks the live catalog (via the introspection helpers
// in migration 20, `security_audit_*`, service_role-only) what is *actually* executable right now.
//
// To see this test do its job: add a new `create function public.whatever() ...` to a scratch
// migration with no grant/revoke statements at all, `supabase db reset`, run this file — the
// "no function outside the allow-lists" tests fail immediately (default anon+authenticated EXECUTE),
// and even a function that *is* properly locked down still fails the "every function is accounted
// for" test until it is added to one of the allow-lists below on purpose. See /docs/security.md.
// ---------------------------------------------------------------------------------------------

type FnGrant = {
  proname: string;
  args: string;
  is_trigger: boolean;
  prosecdef: boolean;
  search_path_pinned: boolean;
  anon_execute: boolean;
  authenticated_execute: boolean;
  service_role_execute: boolean;
};

// Callable by anon (guest checkout) per api-contracts §2/§5 — and, transitively, by authenticated
// staff too (all of these are granted to anon+authenticated+service_role together).
const ANON_CALLABLE = new Set([
  "auth_role",
  "is_staff",
  "menu_item_on_sale",
  "settings_public_keys",
  "settings_staff_keys",       // S2-03: pure key-set helper, read by the settings RLS policies
  "shop_open_at",
  "normalize_phone",
  "quote_order",
  "place_order",
  "get_order_by_token",
  "record_order_attempt",      // S2-03 §1.7: anon writes a rejected checkout through this RPC only
  "order_attempt_items_ok",    // S2-03: immutable CHECK helper on order_attempts.items; pure
]);

// Staff-only (authenticated, never anon) per api-contracts §2/§6.
const AUTHENTICATED_ONLY = new Set([
  "set_order_status",
  "kitchen_pause",
  "update_order_items",
  "add_customer_event",
  "anonymise_silent_customers",
  "order_transition_allowed", // internal helper the staff RPCs above need; pure, no side effect
  // S2-03 §6.10 Berichte — read-only, gated by reports_guard() (any active staff role, never anon)
  "reports_guard",
  "report_revenue_by_day",
  "report_top_items",
  "report_funnel",
  "report_delivery_times",
  // S2-06 §8 — campaigns/CMS. Each has its OWN inline guard narrower than reports_guard():
  // resolve_segment and report_payments are owner/operator only (kitchen/driver get
  // forbidden_for_role despite ACL execute); publish_site is owner only.
  "resolve_segment",
  "report_payments",
  "publish_site",
]);

// service_role only (Edge Functions, cron, one-time bootstrap) — never anon, never authenticated.
const SERVICE_ROLE_ONLY = new Set([
  "current_actor",
  "enqueue_payment_job",
  "claim_payment_jobs",
  "finish_payment_job",
  "record_payment_event",
  "schedule_payment_worker",
  "run_payment_worker",
  "ensure_menu_bucket_policies",
  "ensure_guest_realtime_policy",
  "is_service_request",
  // this audit's own introspection helpers (migration 20) — must never be anon/authenticated-callable
  "security_audit_function_grants",
  "security_audit_table_grants",
  "security_audit_policies",
  // S2-04: the secret payment-worker presents to prove it is the cron and not a holder of the
  // public anon key (finding 7). Readable by nobody else — that is the whole point of it.
  "payment_worker_secret",
  // S2-06 §8.3 — the exact "anon key, service-role authority" shape S7-01/S1 found wrong in
  // payment-worker must not be reproduced here: unreachable with anon OR authenticated.
  "claim_campaign_recipients",
  // S2-06 §8.6 — bucket `site` installer, service_role only (same shape as ensure_menu_bucket_policies,
  // but starting correct: revoked from anon AND authenticated directly, not just `public`).
  "ensure_site_bucket_policies",
]);

// Trigger functions (`returns trigger`) cannot be invoked directly via RPC/PostgREST no matter what
// their grants say — Postgres refuses to call them outside trigger context — so they are exempt
// from the anon/authenticated checks below. Still listed explicitly so a function that stops being
// a trigger (e.g. a refactor changes its return type) falls through to the "accounted for" check.
const TRIGGER_FUNCTIONS = new Set([
  "set_updated_at",
  "orders_before_status_change",
  "orders_after_status_change",
  "orders_count_promo_use",
  "orders_customer_event",
  "customers_consent_changed",
  "orders_broadcast_tracking",
  "payment_jobs_kick_worker",
  // S2-06 §8.1 — the weekly-cap guard; cannot be invoked directly via RPC regardless of grants,
  // same as every other trigger function here.
  "campaign_recipients_enforce_weekly_cap",
]);

async function functionGrants(): Promise<FnGrant[]> {
  const { data, error } = await admin().rpc("security_audit_function_grants");
  if (error) throw new Error(`security_audit_function_grants: ${error.message}`);
  return data as FnGrant[];
}

describe("function grants sweep (public schema, live catalog)", () => {
  it("no function outside the allow-list is anon-executable", async () => {
    const rows = await functionGrants();
    const unexpected = rows.filter((r) => !r.is_trigger && r.anon_execute && !ANON_CALLABLE.has(r.proname));
    expect(unexpected.map((r) => r.proname), JSON.stringify(unexpected)).toEqual([]);
  });

  it("no function outside the allow-lists is authenticated-executable", async () => {
    const rows = await functionGrants();
    const allowed = new Set([...ANON_CALLABLE, ...AUTHENTICATED_ONLY]);
    const unexpected = rows.filter((r) => !r.is_trigger && r.authenticated_execute && !allowed.has(r.proname));
    expect(unexpected.map((r) => r.proname), JSON.stringify(unexpected)).toEqual([]);
  });

  it("every function in `public` is accounted for by one of this audit's lists", async () => {
    // The real regression test: a *new* function — whether it's properly locked down or not —
    // must be added here on purpose. This is what actually catches "someone added a function and
    // forgot about grants" in CI, rather than relying on the author to also remember this file.
    const known = new Set([...ANON_CALLABLE, ...AUTHENTICATED_ONLY, ...SERVICE_ROLE_ONLY, ...TRIGGER_FUNCTIONS]);
    const rows = await functionGrants();
    const unknown = rows.filter((r) => !known.has(r.proname));
    expect(
      unknown.map((r) => r.proname),
      "new function(s) not in apps/backend/tests/security.test.ts's allow-lists — add them there only after confirming the intended anon/authenticated grants",
    ).toEqual([]);
  });

  it("every SECURITY DEFINER function pins search_path", async () => {
    const rows = await functionGrants();
    const unpinned = rows.filter((r) => r.prosecdef && !r.search_path_pinned);
    expect(unpinned.map((r) => r.proname)).toEqual([]);
  });

  it("service-role-only functions are not reachable by anon or authenticated", async () => {
    const rows = await functionGrants();
    for (const name of SERVICE_ROLE_ONLY) {
      const row = rows.find((r) => r.proname === name);
      expect(row, `${name} not found — was it renamed/dropped?`).toBeTruthy();
      expect(row!.anon_execute, `${name} anon_execute`).toBe(false);
      expect(row!.authenticated_execute, `${name} authenticated_execute`).toBe(false);
      expect(row!.service_role_execute, `${name} service_role_execute`).toBe(true);
    }
  });

  it("kitchen_pause and anonymise_silent_customers reject a NULL-role caller instead of silently proceeding", async () => {
    // Both guards used to read `if v_role not in (...)` / `if not (v_role = 'owner' or ...)`.
    // `v_role` is NULL whenever the caller has no matching `staff` row (auth_role() returns NULL);
    // `NULL NOT IN (...)` and `NOT (NULL OR ...)` are both NULL, and plpgsql treats a NULL `IF`
    // condition as false — so the guard silently did not fire. This was masked (not fixed) by
    // migration 18 revoking anon's EXECUTE grant; the function's own logic did not defend itself.
    // A service_role call has EXECUTE (grants above) but resolves auth_role() to NULL too (no
    // impersonated staff JWT) — exactly the shape that used to slip through. See migration 19.
    const { error: kp } = await admin().rpc("kitchen_pause", { paused: true });
    expect(kp?.message).toBe("forbidden_for_role");

    const { error: an } = await admin().rpc("anonymise_silent_customers", { months: 24 });
    // service_role IS allowed to run the GDPR job (is_service_request() exemption, by design —
    // this is the nightly cron's own path) — this call must still succeed, unlike kitchen_pause.
    expect(an).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// RLS sweep (S7-01 task 3)
// ---------------------------------------------------------------------------------------------

type TableGrant = {
  schemaname: string;
  tablename: string;
  rowsecurity: boolean;
  policy_count: number;
  anon_select: boolean;
  authenticated_select: boolean;
};
type Policy = {
  schemaname: string;
  tablename: string;
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
};

async function tableGrants(): Promise<TableGrant[]> {
  const { data, error } = await admin().rpc("security_audit_table_grants");
  if (error) throw new Error(`security_audit_table_grants: ${error.message}`);
  return data as TableGrant[];
}
async function policies(): Promise<Policy[]> {
  const { data, error } = await admin().rpc("security_audit_policies");
  if (error) throw new Error(`security_audit_policies: ${error.message}`);
  return data as Policy[];
}

// Tables intentionally exposed with a bare `using (true)` read policy — public menu metadata only
// (option-group rules, item↔group linkage), no PII, no pricing secrets. Anything else with a
// literal `true` predicate is a finding.
const PERMISSIVE_TRUE_ALLOWLIST = new Set([
  "public.option_groups:option_groups_public_read",
  "public.menu_item_option_groups:item_option_groups_public_read",
]);

describe("RLS sweep (live catalog: public, storage, realtime)", () => {
  it("every table in `public` has row level security enabled", async () => {
    const rows = (await tableGrants()).filter((r) => r.schemaname === "public");
    expect(rows.length).toBeGreaterThan(10); // sanity: the introspection actually saw the schema
    const noRls = rows.filter((r) => !r.rowsecurity);
    expect(noRls.map((r) => r.tablename)).toEqual([]);
  });

  it("every RLS-enabled table has at least one policy (RLS-on-with-zero-policies fails closed, but silently)", async () => {
    const rows = (await tableGrants()).filter((r) => r.schemaname === "public" && r.rowsecurity);
    const noPolicy = rows.filter((r) => r.policy_count === 0);
    expect(noPolicy.map((r) => r.tablename)).toEqual([]);
  });

  it("storage.objects and realtime.messages have row level security enabled", async () => {
    const rows = await tableGrants();
    const storage = rows.find((r) => r.schemaname === "storage" && r.tablename === "objects");
    const realtime = rows.find((r) => r.schemaname === "realtime" && r.tablename === "messages");
    expect(storage, "storage.objects not visible to the introspection function").toBeTruthy();
    expect(realtime, "realtime.messages not visible to the introspection function").toBeTruthy();
    expect(storage!.rowsecurity, "storage.objects RLS").toBe(true);
    expect(realtime!.rowsecurity, "realtime.messages RLS").toBe(true);
  });

  it("no `using (true)` policy in `public` outside the known public-menu-metadata allow-list", async () => {
    const rows = (await policies()).filter((p) => p.schemaname === "public" && p.qual?.trim() === "true");
    const unexpected = rows.filter((p) => !PERMISSIVE_TRUE_ALLOWLIST.has(`${p.schemaname}.${p.tablename}:${p.policyname}`));
    expect(unexpected.map((p) => `${p.tablename}:${p.policyname}`)).toEqual([]);
  });

  it("realtime.messages guest policy is scoped to `order:%` topics, not a blanket read", async () => {
    const rows = (await policies()).filter((p) => p.schemaname === "realtime" && p.tablename === "messages");
    expect(rows.length, "expected exactly the guest-tracking policy from migration 16").toBe(1);
    const pol = rows[0];
    expect(pol.roles).toEqual(expect.arrayContaining(["anon"]));
    expect(pol.qual?.trim()).not.toBe("true");
    expect(pol.qual ?? "").toMatch(/order:/);
  });

  // [S2-06] `storage.objects` is one table shared by every bucket — bucket `site`'s policies
  // (migration 31) land in the exact same (schemaname, tablename) pair as `menu`'s, so this test
  // now checks each bucket's four policies by NAME prefix rather than assuming there are only
  // four policies on the table at all.
  it("storage bucket policies: public read, staff-only write, for both `menu` and `site`", async () => {
    await admin().rpc("ensure_menu_bucket_policies");
    await admin().rpc("ensure_site_bucket_policies");
    const all = (await policies()).filter((p) => p.schemaname === "storage" && p.tablename === "objects");
    for (const prefix of ["menu photos", "site assets"] as const) {
      const rows = all.filter((p) => p.policyname.startsWith(prefix));
      const byCmd = Object.fromEntries(rows.map((p) => [p.cmd, p]));
      expect(rows.map((p) => p.cmd).sort(), prefix).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
      expect(byCmd.SELECT.roles, prefix).toEqual(expect.arrayContaining(["anon", "authenticated"]));
      for (const cmd of ["INSERT", "UPDATE", "DELETE"]) {
        expect(byCmd[cmd].roles, `${prefix} ${cmd}`).toEqual(["authenticated"]);
        expect(byCmd[cmd].with_check ?? byCmd[cmd].qual ?? "", `${prefix} ${cmd}`).toMatch(/is_staff/);
      }
    }
  });

  it("payment_events, payment_jobs, customer_events: staff read-only, no direct write policy exists", async () => {
    for (const table of ["payment_events", "payment_jobs", "customer_events"]) {
      const rows = (await policies()).filter((p) => p.schemaname === "public" && p.tablename === table);
      expect(rows.map((p) => p.cmd), table).toEqual(["SELECT"]);
      expect(rows[0].roles, table).toEqual(["authenticated"]);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Authorisation matrix (S7-01 task 1) — spot-checks against a live client per role, for the
// tables/roles the feature-focused test files (rls.test.ts, customer_events.test.ts,
// payment_jobs.test.ts, webhook.test.ts) do not already exercise directly.
// ---------------------------------------------------------------------------------------------

describe("authorisation matrix: kitchen / driver must not see staff-or-owner-only data", () => {
  let kitchen: Db, driver: Db;
  beforeAll(async () => {
    [kitchen, driver] = await Promise.all([signIn("kitchen"), signIn("driver")]);
  });

  it("promo_codes: invisible to kitchen and driver", async () => {
    expect((await kitchen.from("promo_codes").select("id").limit(1)).data).toEqual([]);
    expect((await driver.from("promo_codes").select("id").limit(1)).data).toEqual([]);
  });

  it("payment_events / payment_jobs: invisible to kitchen and driver", async () => {
    for (const c of [kitchen, driver]) {
      expect((await c.from("payment_events").select("id").limit(1)).data).toEqual([]);
      expect((await c.from("payment_jobs").select("id").limit(1)).data).toEqual([]);
    }
  });

  it("customer_addresses: invisible to kitchen and driver", async () => {
    expect((await kitchen.from("customer_addresses").select("id").limit(1)).data).toEqual([]);
    expect((await driver.from("customer_addresses").select("id").limit(1)).data).toEqual([]);
  });

  // Amended by S2-03: api-contracts §6.9 row 1 (S0, 2026-09-26) ratified `ops` as readable by every
  // staff role — the kitchen board needs prep_default_min / rush_extra_min / preorder_max_days, none
  // of which is sensitive. S7-01 asserted the pre-decision state (public keys only). What still
  // matters, and is what this test now guards, is that the **private** keys stay out: `payments`
  // (provider + payout) and `kitchen` (paused_by uuid, rush). See README "Settings key sets".
  it("settings: kitchen/driver see the public keys plus `ops`, never private `payments`/`kitchen`", async () => {
    for (const c of [kitchen, driver]) {
      const { data } = await c.from("settings").select("key");
      const keys = (data ?? []).map((r: { key: string }) => r.key).sort();
      expect(keys, "kitchen/driver read settings_staff_keys() = the public set + `ops`").toEqual(
        ["business", "kitchen.status", "opening_hours", "ops", "payments.enabled", "site"],
      );
    }
  });

  it("anon and staff cannot call the security-audit introspection helpers", async () => {
    const operator = await signIn("operator");
    for (const c of [anon(), kitchen, driver, operator]) {
      const { error } = await c.rpc("security_audit_function_grants");
      expect(error).not.toBeNull();
    }
  });
});
