import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Same pattern as apps/backend/tests/helpers.ts, deliberately not imported from there: this package
// drives the UI, not the RPC layer directly, and it must work when apps/backend's devDependencies
// (vitest, the Supabase CLI) aren't installed — e.g. a reviewer running only `pnpm --filter @shosho/e2e`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, "public", any>;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set — see apps/e2e/README.md`);
  return v;
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/** Anon-key client — exactly what the guest site and an unauthenticated request use. */
export const anon = (): Db => createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), opts);

export const PASSWORD = process.env.E2E_PASSWORD ?? "shosho-test-2026";
export const STAFF = {
  owner: { email: "owner@shosho.test", name: "K. Sato" },
  operator: { email: "operator@shosho.test", name: "Marek K." },
  kitchen: { email: "kitchen@shosho.test", name: "Lena N." },
  driver: { email: "driver@shosho.test", name: "Jonas M." },
} as const;
export type StaffRole = keyof typeof STAFF;

/**
 * A real staff session (anon key + password auth, never the service-role key — the boot forbids it
 * anywhere in this suite). RLS does the guarding exactly as it would for a human operator: `owner` has
 * full read/write on everything this suite touches, so it's what setup/assertion steps use by default
 * (the `db` fixture); use `signInAs("operator"|"kitchen"|"driver")` when a test specifically needs that
 * role's own, narrower view.
 */
export async function signInAs(role: StaffRole): Promise<Db> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: STAFF[role].email, password: PASSWORD });
  if (error) throw new Error(`sign in ${role}: ${error.message}`);
  return c;
}

// Seed ids (apps/backend/supabase/seed.sql) — kept in sync with apps/backend/tests/helpers.ts by hand;
// if seed.sql changes these, both files need the update (no shared import, see note above).
export const ITEM = {
  philadelphia: "30000000-0000-4000-8000-000000000001", // RL-014 14.90, required Size + Soy sauce
  ramen: "30000000-0000-4000-8000-000000000003", // 13.50, no required groups
  ebiTempura: "30000000-0000-4000-8000-000000000008", // stoplisted in seed
} as const;
export const POSTAL = { zoneA: "10115", zoneB: "10243", zoneC: "10961", outside: "99999" } as const;

let phoneSeq = 0;
/** Unique E.164 phone per call — a shared counter across spec files once broke S2-02's own suite (see
 * apps/backend/tests/helpers.ts's freshPhone comment); the random block is what actually prevents it. */
export function freshPhone(): string {
  phoneSeq += 1;
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `+4917${rand}${(phoneSeq % 1000).toString().padStart(3, "0")}`;
}

/** Tests must not depend on the wall clock or a paused kitchen left over from another run. Settings
 * writes are owner-only (apps/backend/README.md "RLS in one table"), so this signs in as owner. */
export async function openAllDayAndResume(): Promise<void> {
  const owner = await signInAs("owner");
  const all = [["00:00", "24:00"]];
  const { error } = await owner.from("settings").upsert({
    key: "opening_hours",
    value: { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all, holidays: [] },
  });
  if (error) throw error;
  await owner.from("settings").upsert({ key: "kitchen", value: { paused: false, paused_by: null, paused_at: null, rush: false } });
}

export async function rpc<T = unknown>(c: Db, fn: string, args: Record<string, unknown>): Promise<{ data: T; error: { message: string; details?: string } | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (c as any).rpc(fn, args);
  return { data: data as T, error };
}
