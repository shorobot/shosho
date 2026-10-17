// Pure Einstellungen logic: parsing the settings keys this screen reads/writes, and the team-row
// shape. No I/O here — lib/settingsStore.tsx does the RPC/PostgREST calls. Unit-tested in
// tests/settings.test.ts.
import type { BusinessValue } from "@/lib/site";
import type { Json, KitchenStatus, OpsSettings, PaymentsEnabledValue, PaymentsValue, StaffDirectoryRow } from "@/lib/types";

function asObject(v: Json | undefined): Record<string, Json> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
}

export function parseOps(v: Json): OpsSettings {
  const o = asObject(v);
  const n = (x: Json | undefined) => (typeof x === "number" ? x : undefined);
  const b = (x: Json | undefined) => (typeof x === "boolean" ? x : undefined);
  return {
    prep_default_min: n(o.prep_default_min),
    rush_extra_min: n(o.rush_extra_min),
    preorder_max_days: n(o.preorder_max_days),
    auto_accept_paid_under_cents: n(o.auto_accept_paid_under_cents),
    pause_allowed: b(o.pause_allowed),
    pickup_discount_pct: n(o.pickup_discount_pct),
  };
}

/** A settings write replaces the whole key (no `draft` staging here — ops/kitchen take effect immediately, unlike BO · Website's keys). */
export function opsToJson(v: OpsSettings, current: Json): Json {
  return { ...asObject(current), ...v } as Json;
}

export function parseKitchenStatus(v: Json): KitchenStatus & { capacity?: number } {
  const o = asObject(v);
  const n = (x: Json | undefined) => (typeof x === "number" ? x : undefined);
  const b = (x: Json | undefined) => (typeof x === "boolean" ? x : undefined);
  return { paused: b(o.paused), since: typeof o.since === "string" ? o.since : null, capacity: n(o.capacity) };
}

export function kitchenStatusCapacityToJson(capacity: number, current: Json): Json {
  return { ...asObject(current), capacity } as Json;
}

export function parsePayments(v: Json): PaymentsValue {
  const o = asObject(v);
  const payout = asObject(o.payout);
  return {
    provider: typeof o.provider === "string" ? o.provider : undefined,
    cash_on_delivery: typeof o.cash_on_delivery === "boolean" ? o.cash_on_delivery : undefined,
    payout: { iban_last4: typeof payout.iban_last4 === "string" ? payout.iban_last4 : null },
  };
}

export function parsePaymentsEnabled(v: Json): PaymentsEnabledValue {
  const o = asObject(v);
  return {
    methods: Array.isArray(o.methods) ? (o.methods as string[]) : undefined,
    tip_presets_cents: Array.isArray(o.tip_presets_cents) ? (o.tip_presets_cents as number[]) : undefined,
    capture: typeof o.capture === "string" ? o.capture : undefined,
  };
}

export function parseBusiness(v: Json): Pick<BusinessValue, "impressum" | "ust_id"> {
  const o = asObject(v);
  return {
    impressum: typeof o.impressum === "string" ? o.impressum : undefined,
    ust_id: typeof o.ust_id === "string" ? o.ust_id : undefined,
  };
}

/** staff_directory (§6.9 row 2) sorted the way a team list reads best: owner/operator first, then kitchen/driver, active before inactive, then name. */
const ROLE_RANK: Record<string, number> = { owner: 0, operator: 1, kitchen: 2, driver: 3 };

export function sortTeam(rows: StaffDirectoryRow[]): StaffDirectoryRow[] {
  return [...rows].sort((a, b) => {
    const activeA = a.active ?? false;
    const activeB = b.active ?? false;
    if (activeA !== activeB) return activeA ? -1 : 1;
    const r = (ROLE_RANK[a.role ?? ""] ?? 9) - (ROLE_RANK[b.role ?? ""] ?? 9);
    if (r !== 0) return r;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}
