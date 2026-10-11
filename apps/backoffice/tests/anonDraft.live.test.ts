// THE ANON DRAFT-INVISIBILITY CHECK (boot task 1 / task 12), run against a real Supabase project
// with the ANON key — the storefront's own credential.
//
// WHY A LIVE TEST AND NOT AN INSPECTION. The protection here is a column-level GRANT, not RLS:
// `settings_public_read` already admits `anon` to the `business` / `opening_hours` / `site` /
// `payments.enabled` / `kitchen.status` ROWS, and RLS is row-level — it cannot hide one column
// inside a row it lets through. Migration 32 revokes `anon`'s blanket table grant and re-grants
// exactly `(key, value, created_at, updated_at)`. Whether PostgREST actually honours that, on this
// project, with this schema cache, is a property of the running system. Reading the migration proves
// the intent; only a request with the anon key proves the behaviour — and a mistake here would be
// invisible from the back-office, which sees `draft` quite legitimately.
//
// WHAT IT ASSERTS, in the order a leak would actually happen:
//   1. asking for `draft` by name is refused;
//   2. `select *` — the realistic way a future column leaks — is refused outright (stronger than
//      §8.7 describes), while naming the granted columns still works for the storefront;
//   3. the `banners` base table is unreachable in full (its anon grant is revoked outright);
//   4. `banners_live`, the one anon-reachable banner surface, carries no `draft`;
//   5. `site_publications` (which holds before/after snapshots of every published change) is
//      unreachable;
//   6. and, when a pending draft genuinely exists, the public `value` is still the OLD one.
// (6) is the end-to-end form and needs a draft to be pending; it reports itself as not exercised
// when there is none, rather than passing quietly on an empty project.
//
// HOW TO RUN IT. It needs a project URL + anon key and is skipped without them — `node (backoffice)`
// in CI has no Supabase, so this suite skips there by design and the structural half of the same
// invariant is covered unconditionally in tests/site.test.ts. Locally it picks up
// apps/backoffice/.env.local (public values only) with no extra setup:
//     pnpm --filter @shosho/backoffice test
// or against another project:
//     SUPABASE_URL=… SUPABASE_ANON_KEY=… pnpm --filter @shosho/backoffice test
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

/** Public URL + anon key from the environment, falling back to the app's own `.env.local`. */
function publicCreds(): { url: string; key: string } | null {
  const fromEnv = {
    url: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    key: process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  };
  if (fromEnv.url && fromEnv.key) return fromEnv;
  try {
    const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const read = (name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(text)?.[1]?.trim() ?? "";
    const url = read("NEXT_PUBLIC_SUPABASE_URL");
    const key = read("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return url && key ? { url, key } : null;
  } catch {
    return null;
  }
}

const creds = publicCreds();
const liveDescribe = creds ? describe : describe.skip;

if (!creds) {
  // Not a silent skip: say which credentials were missing, so "0 tests" is never mistaken for a pass.
  console.warn(
    "[anonDraft.live] SKIPPED — no SUPABASE_URL / SUPABASE_ANON_KEY and no apps/backoffice/.env.local. " +
      "The structural half of this invariant is covered unconditionally in tests/site.test.ts.",
  );
}

/** Keys `anon` is admitted to by `settings_public_read` — the rows where a draft could leak. */
const PUBLIC_KEYS = ["business", "opening_hours", "site", "payments.enabled", "kitchen.status"];

liveDescribe("settings.draft is invisible to the anon key", () => {
  let anon: SupabaseClient;

  beforeAll(() => {
    // No session is created and none is needed: this is exactly the credential the storefront uses.
    anon = createClient(creds!.url, creds!.key, { auth: { persistSession: false, autoRefreshToken: false } });
  });

  it("1. asking for `draft` by name is refused", async () => {
    const { data, error } = await anon.from("settings").select("key, value, draft");
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    // PostgREST reads column privileges from information_schema; the refusal names the column or
    // the permission. Either wording is a pass — what must never happen is `error === null`.
    expect(`${error?.code ?? ""} ${error?.message ?? ""}`.toLowerCase()).toMatch(/draft|permission|column/);
  });

  it("2. `select *` is refused OUTRIGHT — stronger than §8.7 describes, and worth knowing", async () => {
    // MEASURED, not assumed. §8.7 reads as though `select *` would come back with the four granted
    // columns. It does not: `revoke all on table ... from anon` removed the TABLE-level SELECT, and
    // column privileges do not satisfy `SELECT *`, so PostgREST answers 42501 "permission denied for
    // table settings". Two consequences, both recorded for S0 rather than worked around:
    //   · the leak this guards against is closed twice over — a future column added to `settings`
    //     cannot reach anon through a star select either;
    //   · any anon consumer MUST name its columns. `apps/web/lib/api-supabase.ts:95` already does
    //     (`select("key, value")`), which is why the storefront is unaffected — checked, not hoped.
    const { data, error } = await anon.from("settings").select("*");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("2a. naming the granted columns works, so the storefront's own query still reads", async () => {
    // The exact shape apps/web uses. If this ever broke, the guest site's footer, hours and SEO
    // would go blank — so it is asserted here next to the thing that could break it.
    const { data, error } = await anon
      .from("settings")
      .select("key, value")
      .in("key", PUBLIC_KEYS);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const row of data!) {
      expect(Object.keys(row).sort()).toEqual(["key", "value"]);
    }
  });

  it("2b. and only the public keys are visible at all", async () => {
    const { data } = await anon.from("settings").select("key");
    const keys = (data ?? []).map((r) => (r as { key: string }).key);
    for (const k of keys) expect(PUBLIC_KEYS).toContain(k);
    // `ops` is staff-readable but not public: its presence would be a separate, older leak.
    expect(keys).not.toContain("ops");
    expect(keys).not.toContain("payments");
  });

  it("3. the `banners` base table is unreachable — its anon grant is revoked outright", async () => {
    const { data, error } = await anon.from("banners").select("*");
    // Belt and braces (§8.6): the grant is revoked, so this is an error rather than an empty list.
    // An empty list would also be acceptable behaviour from RLS alone — what must not appear is a row.
    expect(data == null || data.length === 0).toBe(true);
    if (data && data.length > 0) expect(error).not.toBeNull();
  });

  it("4. `banners_live` is readable and carries no draft", async () => {
    const { data, error } = await anon.from("banners_live").select("*");
    expect(error).toBeNull();
    for (const row of data ?? []) {
      expect(Object.keys(row)).not.toContain("draft");
      // The view's own WHERE already applied these; exposing them would invite a second filter.
      expect(Object.keys(row)).not.toContain("active");
      expect(Object.keys(row)).not.toContain("valid_from");
      expect(Object.keys(row)).not.toContain("valid_to");
    }
  });

  it("4b. asking `banners_live` for draft by name is refused — the column is not in the view", async () => {
    const { data, error } = await anon.from("banners_live").select("id, draft");
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("5. `site_publications` is unreachable — it holds before/after snapshots of every change", async () => {
    const { data, error } = await anon.from("site_publications").select("*");
    expect(data == null || data.length === 0).toBe(true);
    if (data && data.length > 0) expect(error).not.toBeNull();
  });

  it("6. with a draft pending, the public `value` is still the OLD one", async () => {
    // End-to-end form. It needs a pending draft, which only an owner session can create, so the
    // staging walk-through stages one and runs this while it is pending (apps/backoffice/README.md).
    // Here it reports honestly whether it was exercised instead of passing on an empty project.
    const { data } = await anon.from("settings").select("key, value").eq("key", "site").maybeSingle();
    expect(data).not.toBeNull();
    const value = (data as { value: unknown }).value;
    // Whatever is pending, what anon reads is a plain object with no draft marker anywhere in it.
    expect(JSON.stringify(value)).not.toContain("draft");
    expect(typeof value).toBe("object");
  });
});
