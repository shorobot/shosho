import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Tests use untyped clients on purpose: they exercise the live schema, the generated
// types in ../types/database.ts are the contract for S3/S4.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = SupabaseClient<any, "public", any>;

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };

export const anon = (): Db => createClient(url, anonKey, opts);
export const admin = (): Db => createClient(url, serviceKey, opts);

export const PASSWORD = "shosho-test-2026";
export const STAFF = {
  owner: { email: "owner@shosho.test", id: "10000000-0000-4000-8000-000000000001" },
  operator: { email: "operator@shosho.test", id: "10000000-0000-4000-8000-000000000002" },
  kitchen: { email: "kitchen@shosho.test", id: "10000000-0000-4000-8000-000000000003" },
  driver: { email: "driver@shosho.test", id: "10000000-0000-4000-8000-000000000004" },
} as const;

export async function signIn(role: keyof typeof STAFF): Promise<Db> {
  const c = anon();
  const { error } = await c.auth.signInWithPassword({ email: STAFF[role].email, password: PASSWORD });
  if (error) throw new Error(`sign in ${role}: ${error.message}`);
  return c;
}

// Seed ids (supabase/seed.sql)
export const ITEM = {
  philadelphia: "30000000-0000-4000-8000-000000000001", // RL-014 14.90, required Size + Soy sauce
  signatureSet: "30000000-0000-4000-8000-000000000002", // 38.90, required Soy sauce
  ramen: "30000000-0000-4000-8000-000000000003", // 13.50, no required groups
  udon: "30000000-0000-4000-8000-000000000004", // 11.00
  ebiTempura: "30000000-0000-4000-8000-000000000008", // stoplisted today
  miso: "30000000-0000-4000-8000-000000000009", // 3.20
} as const;
export const OPT = {
  size8: "41000000-0000-4000-8000-000000000101",
  size16: "41000000-0000-4000-8000-000000000102",
  soyClassic: "41000000-0000-4000-8000-000000000301",
  soyNone: "41000000-0000-4000-8000-000000000304",
  extraWasabi: "41000000-0000-4000-8000-000000000201",
  avocado: "41000000-0000-4000-8000-000000000403",
} as const;
export const POSTAL = { zoneA: "10115", zoneB: "10243", zoneC: "10961", outside: "99999" } as const;

let phoneSeq = 0;
/**
 * Unique E.164 phone per call so customer / first-order state never leaks between tests.
 * The random block matters: test files run in separate module registries, so a per-file counter
 * plus a coarse clock value collided between files and made two suites share one customer.
 */
export function freshPhone(): string {
  phoneSeq += 1;
  const rand = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
  return `+4917${rand}${(phoneSeq % 1000).toString().padStart(3, "0")}`;
}

export function ramenOrder(overrides: Record<string, unknown> = {}) {
  return {
    type: "delivery",
    items: [{ item_id: ITEM.ramen, qty: 2 }],
    contact: { name: "Test Guest", phone: freshPhone() },
    address: { street: "Kastanienallee 1", postal_code: POSTAL.zoneB, city: "Berlin" },
    payment_method: "card",
    ...overrides,
  };
}

export async function rpc<T = any>(c: Db, fn: string, args: Record<string, unknown>) {
  const { data, error } = await (c as any).rpc(fn, args);
  return { data: data as T, error };
}

/** Tests must not depend on the wall clock: open 24/7 while the suite runs. */
export async function openAllDay() {
  const a = admin();
  const all = [["00:00", "24:00"]];
  const { error } = await a.from("settings").upsert({
    key: "opening_hours",
    value: { mon: all, tue: all, wed: all, thu: all, fri: all, sat: all, sun: all, holidays: [] },
  });
  if (error) throw error;
  await a.from("settings").upsert({ key: "kitchen", value: { paused: false, paused_by: null, paused_at: null, rush: false } });
}
