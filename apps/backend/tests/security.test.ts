import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anon, freshPhone, newCustomerAuth, openAllDay, signIn, type Db } from "./helpers";

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
  agent_execute: boolean;
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
  // S2-09 §9.6 — the only path that can move an agent_outputs row off `pending`. owner/operator
  // only (inline guard inside the function); never anon, never the `agent` role itself (the §9.6
  // asymmetry — see AGENT_ROLE_ONLY's comment on claim_agent_tasks/finish_agent_run below).
  "review_agent_output",
  // [S2-07] §9 — the customer self-service surface. `authenticated` only, never anon: each one
  // resolves the caller through auth.uid() -> customers.auth_user_id and raises
  // `no_customer_account` (42501) when there is no linked profile, so an anon-callable variant
  // would be a function whose guard depends on a NULL uid.
  "link_my_account",
  "get_my_profile",
  "update_my_profile",
  "get_my_orders",
  "add_my_address",
  "update_my_address",
  "set_my_default_address",
  "delete_my_address",
  // used by `customer_addresses_self_read`; a policy expression is evaluated as the querying role,
  // so `authenticated` must hold EXECUTE on it or the policy errors instead of filtering.
  "current_customer_id",
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
  // [S2-07] §9 internals — the raising variant of current_customer_id(), and the reader of the
  // verified identifiers on auth.users. Both are called only from inside the security-definer RPCs
  // above (which run as the function owner), never over PostgREST.
  "require_customer_id",
  "my_verified_identifiers",
]);

// S2-09 — the `agent` Postgres role's own set (docs/security.md §9.1, S7-03's ruling): a dedicated,
// non-BYPASSRLS role, never service_role. `claim_agent_tasks`/`finish_agent_run` moved here from
// SERVICE_ROLE_ONLY in migration 34 — EXECUTE revoked from service_role, granted to `agent` only.
// `agent` connects via a direct Postgres connection (AUTOMATION_DATABASE_URL), never through
// PostgREST, so there is no anon/authenticated/service_role JWT shape to assert against via the
// normal `admin()`/`anon()`/`signIn()` helpers here — that refusal is tested in
// agent_role.test.ts against the live catalog and via `SET ROLE agent` on a raw connection
// instead. Still asserted below: neither anon nor authenticated can reach them (the PostgREST
// surface), and service_role no longer can either (the ruling's whole point).
const AGENT_ROLE_ONLY = new Set(["claim_agent_tasks", "finish_agent_run"]);

// [S2-07] Reachable by NO role — not anon, not authenticated, not service_role, not agent. The
// tightest category there is, and worth having its own list rather than being filed under
// SERVICE_ROLE_ONLY (which asserts service_role CAN reach it). `log_account_link` writes the
// account-link audit event and is only ever called from inside link_my_account().
const NO_ROLE_INTERNAL = new Set(["log_account_link"]);

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
    const known = new Set([...ANON_CALLABLE, ...AUTHENTICATED_ONLY, ...SERVICE_ROLE_ONLY, ...AGENT_ROLE_ONLY, ...NO_ROLE_INTERNAL, ...TRIGGER_FUNCTIONS]);
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

  it("service-role-only functions are not reachable by anon, authenticated, or agent", async () => {
    const rows = await functionGrants();
    for (const name of SERVICE_ROLE_ONLY) {
      const row = rows.find((r) => r.proname === name);
      expect(row, `${name} not found — was it renamed/dropped?`).toBeTruthy();
      expect(row!.anon_execute, `${name} anon_execute`).toBe(false);
      expect(row!.authenticated_execute, `${name} authenticated_execute`).toBe(false);
      expect(row!.service_role_execute, `${name} service_role_execute`).toBe(true);
      expect(row!.agent_execute, `${name} agent_execute`).toBe(false);
    }
  });

  it("agent-only functions are reachable by agent alone — not anon, authenticated, or service_role (S2-09 §9.1)", async () => {
    const rows = await functionGrants();
    for (const name of AGENT_ROLE_ONLY) {
      const row = rows.find((r) => r.proname === name);
      expect(row, `${name} not found — was it renamed/dropped?`).toBeTruthy();
      expect(row!.anon_execute, `${name} anon_execute`).toBe(false);
      expect(row!.authenticated_execute, `${name} authenticated_execute`).toBe(false);
      // The ruling's whole point: service_role must no longer reach these, only `agent`.
      expect(row!.service_role_execute, `${name} service_role_execute`).toBe(false);
      expect(row!.agent_execute, `${name} agent_execute`).toBe(true);
    }
  });

  it("no-role internals are reachable by nothing — anon, authenticated, service_role and agent all refused (S2-07 §9)", async () => {
    const rows = await functionGrants();
    for (const name of NO_ROLE_INTERNAL) {
      const row = rows.find((r) => r.proname === name);
      expect(row, `${name} not found — was it renamed/dropped?`).toBeTruthy();
      expect(row!.anon_execute, `${name} anon_execute`).toBe(false);
      expect(row!.authenticated_execute, `${name} authenticated_execute`).toBe(false);
      expect(row!.service_role_execute, `${name} service_role_execute`).toBe(false);
      expect(row!.agent_execute, `${name} agent_execute`).toBe(false);
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
      expect(rows.map((p) => p.cmd), table).not.toEqual(expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]));
      const staffRow = rows.find((p) => p.roles.includes("authenticated"));
      expect(staffRow, `${table}: no authenticated policy found`).toBeTruthy();
      expect(staffRow!.cmd, table).toBe("SELECT");
      expect(staffRow!.roles, table).toEqual(["authenticated"]);
    }
  });

  it("payment_events / payment_jobs carry the `agent` role's own SELECT policy too (S2-09 §9.1); customer_events does not", async () => {
    for (const table of ["payment_events", "payment_jobs"]) {
      const rows = (await policies()).filter((p) => p.schemaname === "public" && p.tablename === table);
      const agentRow = rows.find((p) => p.roles.includes("agent"));
      expect(agentRow, `${table}: no agent policy found`).toBeTruthy();
      expect(agentRow!.cmd, table).toBe("SELECT");
    }
    const customerEventsRows = (await policies()).filter((p) => p.schemaname === "public" && p.tablename === "customer_events");
    expect(customerEventsRows.some((p) => p.roles.includes("agent")), "customer_events must not grant agent anything").toBe(false);
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

// ---------------------------------------------------------------------------------------------
// [S2-07] task 5 — the row nobody has ever tested: a real, non-staff customer JWT.
//
// Until migration 35 no customer could hold a JWT at all, so every staff surface was safe against
// one only as a *side effect*: `auth_role()` is `select role from public.staff where id =
// auth.uid() and active` — a lookup, so a customer gets NULL and `is_staff()` coalesces to false.
// That is a property worth a passing test precisely because nothing was defending it on purpose.
//
// The boot's suggestion was to re-run the `security_audit_*` matrix with a customer JWT "as a new
// column". Measured, that cannot work and would prove nothing: those helpers report
// `has_*_privilege('authenticated', …)`, which is a per-ROLE fact, and a customer and a staff
// member are the SAME Postgres role (`authenticated`). The grant columns would be identical by
// construction. What separates them is RLS predicates and the guards inside functions, so this has
// to be a behavioural test — real calls with a real customer JWT. See S2-07's report.
//
// It also records WHICH KIND of refusal each surface gives, because this project keeps rediscovering
// that they are not the same thing:
//   * a function with an internal guard RAISES (42501) — the caller is told
//   * a SELECT under RLS returns [] with no error — silent
//   * an INSERT under RLS RAISES; an UPDATE/DELETE affects 0 rows with no error — silent
// A test that only asserts "no rows came back" cannot tell a refusal from an empty table, so the
// silent cases below assert the data is still there afterwards as well.
// ---------------------------------------------------------------------------------------------
describe("[S2-07] a real customer JWT is refused by every staff surface and every report", () => {
  let customer: Db;
  let strangerId: string;
  const STRANGER_NOTE = "SESAME ANAPHYLAXIS — do not serve";

  beforeAll(async () => {
    const a = admin();
    // a stranger with real data, so "empty result" is a refusal and not an empty table
    const { data: stranger, error: sErr } = await a
      .from("customers")
      .insert({ name: "Stranger S7", phone: freshPhone(), kitchen_note: STRANGER_NOTE })
      .select().single();
    if (sErr) throw sErr;
    strangerId = (stranger as any).id;

    // a linked customer — the caller
    const { data: own, error: oErr } = await a
      .from("customers").insert({ name: "Matrix Caller", phone: freshPhone() }).select().single();
    if (oErr) throw oErr;
    const acct = await newCustomerAuth({ phone: (own as any).phone });
    const { data: link, error: lErr } = await acct.client.rpc("link_my_account");
    if (lErr) throw lErr;
    expect((link as any).outcome, "fixture: the caller is a linked customer").toBe("linked_by_phone");
    customer = acct.client;
  });

  it("is not staff, by the only mechanism that decides it", async () => {
    // auth_role() is `select role from public.staff where id = auth.uid() and active` — a lookup,
    // not an assumption. This one null is what every `is_staff(...)` predicate in every policy
    // coalesces to false, which is the whole reason the backend was already safe against a second
    // class of authenticated user. is_staff() itself is VARIADIC and awkward to call over
    // PostgREST, so it is proved behaviourally by the refusals below instead.
    const { data: role } = await customer.rpc("auth_role");
    expect(role, "auth_role() is a lookup in `staff`, so a customer gets null").toBeNull();
    const { data: staffRow } = await admin().from("staff").select("id").eq("id", strangerId);
    expect(staffRow ?? [], "fixture sanity: the caller is not in `staff`").toEqual([]);
  });

  // Every staff-only and service-only RPC in api-contracts §2 / §6 / §8. Each must RAISE: these
  // are functions with their own guards, so a customer must be told no, not handed an empty result.
  const STAFF_RPCS: Array<[string, Record<string, unknown>]> = [
    ["kitchen_pause", { paused: true }],
    ["anonymise_silent_customers", { months: 1 }],
    ["resolve_segment", { p_segment: {}, p_channel: "push" }],
    ["publish_site", {}],
    ["reports_guard", {}],
    ["report_revenue_by_day", { from_date: "2026-01-01", to_date: "2026-12-31" }],
    ["report_top_items", { from_date: "2026-01-01", to_date: "2026-12-31", limit_count: 10 }],
    ["report_funnel", { from_date: "2026-01-01", to_date: "2026-12-31" }],
    ["report_delivery_times", { from_date: "2026-01-01", to_date: "2026-12-31" }],
    ["report_payments", { from_date: "2026-01-01", to_date: "2026-12-31" }],
    ["claim_campaign_recipients", { p_limit: 5 }],
    ["claim_payment_jobs", { p_limit: 5 }],
    ["claim_agent_tasks", { p_limit: 1 }],
    ["security_audit_function_grants", {}],
    ["security_audit_table_grants", {}],
    ["security_audit_policies", {}],
    ["payment_worker_secret", {}],
    ["is_service_request", {}],
    ["current_actor", {}],
    ["require_customer_id", {}],
    ["my_verified_identifiers", {}],
    ["log_account_link", { p_customer_id: null, p_outcome: "forged", p_reason: null, p_uid: null }],
  ];

  it("every staff-only and service-only RPC raises, none returns data", async () => {
    const leaked: string[] = [];
    for (const [fn, args] of STAFF_RPCS) {
      const { error } = await customer.rpc(fn, args);
      if (!error) leaked.push(fn);
    }
    expect(leaked, "these answered a customer JWT instead of refusing").toEqual([]);
  });

  it("set_order_status / update_order_items / add_customer_event raise 42501 with the role guard", async () => {
    // A literal id, not one looked up from `orders`: the role guard in each of these fires before
    // any row lookup, and `.single()` on an empty table yields undefined — which PostgREST then
    // drops from the argument list, so the call fails overload resolution ("Could not find the
    // function") instead of reaching the guard. That is a harness artefact, not a refusal.
    const ABSENT = "00000000-0000-4000-8000-0000000000aa";
    const cases: Array<[string, Record<string, unknown>]> = [
      ["set_order_status", { order_id: ABSENT, new_status: "accepted", payload: {} }],
      ["update_order_items", { order_id: ABSENT, items: [] }],
      ["add_customer_event", { customer_id: strangerId, type: "note", payload: { text: "x" } }],
    ];
    for (const [fn, args] of cases) {
      const { error } = await customer.rpc(fn, args);
      expect(error, `${fn} must refuse`).not.toBeNull();
      expect(error!.message, fn).toMatch(/not_staff|forbidden_for_role/);
    }
  });

  // The silent class. Each of these returns [] rather than an error, which is why the assertion is
  // "no rows came back AND the data is demonstrably still there".
  it("every staff table read comes back empty — and the data it would have shown still exists", async () => {
    const TABLES = [
      "customers", "customer_events", "orders", "order_items", "order_events", "staff",
      "payment_events", "payment_jobs", "order_attempts", "campaigns", "campaign_recipients",
      "automations", "banners", "site_publications", "promo_codes", "agent_runs", "agent_outputs",
    ];
    for (const t of TABLES) {
      const { data, error } = await customer.from(t).select("*").limit(5);
      expect(error, `${t}: expected a silent empty result, not an error`).toBeNull();
      expect(data ?? [], `${t} must be empty for a customer`).toEqual([]);
    }
    // the ground truth the emptiness above is hiding
    const { data: real } = await admin().from("customers").select("id").limit(5);
    expect(real!.length, "there IS data in customers — the empty results were refusals").toBeGreaterThan(0);
  });

  it("no kitchen_note of anyone else is reachable, by table, by view or by RPC", async () => {
    const { data: viaTable } = await customer.from("customers").select("kitchen_note").not("kitchen_note", "is", null);
    expect(viaTable ?? []).toEqual([]);

    const { data: viaView } = await customer.from("customer_stats").select("*").limit(5);
    expect(viaView ?? [], "customer_stats is security_invoker, so it narrows with the caller").toEqual([]);

    const { data: profile } = await customer.rpc("get_my_profile");
    expect(JSON.stringify(profile ?? {})).not.toContain("SESAME");

    const { data: orders } = await customer.rpc("get_my_orders");
    expect(JSON.stringify(orders ?? {})).not.toContain("SESAME");

    // and it is still on the stranger's row, so none of the above was an empty table
    const { data: still } = await admin()
      .from("customers").select("kitchen_note").eq("id", strangerId).single();
    expect(still!.kitchen_note).toBe(STRANGER_NOTE);
  });

  it("private settings keys stay private", async () => {
    const { data } = await customer.from("settings").select("key");
    const keys = (data ?? []).map((r: { key: string }) => r.key);
    for (const k of ["payments", "kitchen", "ops"]) {
      expect(keys, `a customer must not read settings.${k}`).not.toContain(k);
    }
    expect(keys.sort(), "a customer sees exactly the public set, same as anon").toEqual(
      ["business", "kitchen.status", "opening_hours", "payments.enabled", "site"],
    );
  });

  it("writes are refused — INSERT raises, UPDATE/DELETE are silent no-ops, nothing changes", async () => {
    // INSERT: raises. This is the loud half.
    for (const [t, row] of [
      ["customers", { name: "Forged", phone: freshPhone() }],
      ["staff", { id: "00000000-0000-4000-8000-0000000000ff", name: "Me", role: "owner", active: true }],
      ["promo_codes", { code: "FREE100", kind: "percent", value: 100 }],
    ] as const) {
      const { error } = await customer.from(t).insert(row as Record<string, unknown>);
      expect(error, `INSERT into ${t} must raise`).not.toBeNull();
    }

    // UPDATE / DELETE: silent. This is the half a "no rows" assertion cannot distinguish, so the
    // test asserts the target is unchanged afterwards instead of trusting the empty return.
    const { data: upd, error: uErr } = await customer
      .from("customers").update({ kitchen_note: "HIJACKED", tags: ["vip"] }).eq("id", strangerId).select();
    expect(uErr, "no error at all — the silent class").toBeNull();
    expect(upd ?? []).toEqual([]);

    const { data: del, error: dErr } = await customer
      .from("customers").delete().eq("id", strangerId).select();
    expect(dErr).toBeNull();
    expect(del ?? []).toEqual([]);

    const { data: after } = await admin()
      .from("customers").select("kitchen_note, tags").eq("id", strangerId).single();
    expect(after, "the row still exists").toBeTruthy();
    expect(after!.kitchen_note, "and is byte-for-byte unchanged").toBe(STRANGER_NOTE);
    expect(after!.tags).toEqual([]);

    const { data: settings } = await customer
      .from("settings").update({ value: { hacked: true } }).eq("key", "ops").select();
    expect(settings ?? []).toEqual([]);
  });

  it("the storage buckets staff write to are not writable by a customer", async () => {
    for (const bucket of ["menu", "site"]) {
      const { error } = await customer.storage.from(bucket)
        .upload(`s2-07-probe-${Date.now()}.txt`, new Blob(["x"]), { contentType: "text/plain" });
      expect(error, `${bucket} must refuse a customer upload`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// [S2-07] THE ONE PLACE "safe by construction" DOES NOT HOLD — found by doing task 4, and the
// reason this phase needed a behavioural test rather than a grant audit.
//
// Migration 32 named the pitfall itself: RLS is row-level, not column-level, so adding
// `settings.draft` to a publicly-readable row would hand `anon` every unpublished edit. Its fix
// was a column grant — `revoke all on settings from anon; grant select (key, value, created_at,
// updated_at) to anon` — and its comment says `authenticated` deliberately keeps the blanket
// table grant "so owner/operator continue to see `draft` on the rows their existing ROW policies
// already admit them to".
//
// That reasoning was sound while `authenticated` could only ever be staff. Migration 35 creates
// the second class of authenticated user, and a customer passes `settings_public_read`
// (`key = any (settings_public_keys())`, which includes `site`) — so a customer reads
// `settings.draft` on the `site` row: the unpublished site copy. Measured, not inferred.
//
// Column privileges cannot fix it, because a customer and an operator are the same Postgres role:
// narrowing `authenticated`'s column list would also blind the back-office draft editor (§6.6
// reads `from('settings')` directly). The candidate fixes are all someone else's call — move
// `draft` to its own staff-only table, or serve the public settings through a view/RPC and
// narrow the table — so this is REPORTED, NOT FIXED, and filed for S7-04 / S0.
//
// Nothing is exposed in production today: phase A ships no login, so no customer JWT exists yet.
// It must be resolved before phase B (S3-04) ships one.
//
// `it.fails` on purpose: it passes while the defect stands, and starts failing the moment someone
// fixes it — at which point whoever fixed it deletes the `.fails` and keeps the assertion.
// ---------------------------------------------------------------------------------------------
describe("[S2-07] known finding: settings.draft is reachable by a customer JWT", () => {
  let customer: Db;

  beforeAll(async () => {
    const a = admin();
    const { data: own } = await a
      .from("customers").insert({ name: "Draft Probe", phone: freshPhone() }).select().single();
    const acct = await newCustomerAuth({ phone: (own as any).phone });
    await acct.client.rpc("link_my_account");
    customer = acct.client;
    await a.from("settings").update({ draft: { hero: "UNPUBLISHED COPY" } }).eq("key", "site");
  });

  afterAll(async () => {
    await admin().from("settings").update({ draft: null }).eq("key", "site");
  });

  it("anon still cannot — migration 32's column grant holds for the role it was written for", async () => {
    const { error } = await anon().from("settings").select("key, draft");
    expect(error, "anon has no SELECT on the `draft` column").not.toBeNull();
  });

  it("a customer cannot read other staff-only settings columns it has no row for", async () => {
    // the scope of the finding, asserted so it cannot widen unnoticed: only rows
    // settings_public_keys() admits, never `payments` or `kitchen`.
    const { data } = await customer.from("settings").select("key, draft");
    const keys = (data ?? []).map((r: { key: string }) => r.key).sort();
    expect(keys).toEqual(["business", "kitchen.status", "opening_hours", "payments.enabled", "site"]);
  });

  it.fails("a customer must not read settings.draft (fails today — see the block comment)", async () => {
    const { data, error } = await customer.from("settings").select("key, draft").eq("key", "site").single();
    expect(error).toBeNull();
    expect((data as any)?.draft, "the unpublished site copy must not reach a customer").toBeNull();
  });
});
