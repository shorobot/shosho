// BO · Einstellungen logic (api-contracts §6.6 / §6.9). The one thing worth pinning with tests:
// sortTeam's ordering, and that the parse helpers tolerate the shapes seed.sql and a stale/missing
// row actually produce rather than assuming a clean object every time.
import { describe, expect, it } from "vitest";
import { kitchenStatusCapacityToJson, opsToJson, parseKitchenStatus, parseOps, parsePayments, parsePaymentsEnabled, sortTeam } from "@/lib/settings";
import type { StaffDirectoryRow } from "@/lib/types";

describe("parseOps / opsToJson", () => {
  it("reads the seed shape", () => {
    const v = parseOps({ prep_default_min: 22, rush_extra_min: 15, preorder_max_days: 7, auto_accept_paid_under_cents: 5000, pause_allowed: true, pickup_discount_pct: 10 });
    expect(v).toEqual({ prep_default_min: 22, rush_extra_min: 15, preorder_max_days: 7, auto_accept_paid_under_cents: 5000, pause_allowed: true, pickup_discount_pct: 10 });
  });

  it("tolerates a missing/empty value rather than throwing", () => {
    expect(parseOps({})).toEqual({ prep_default_min: undefined, rush_extra_min: undefined, preorder_max_days: undefined, auto_accept_paid_under_cents: undefined, pause_allowed: undefined, pickup_discount_pct: undefined });
    expect(parseOps(null)).toEqual(parseOps({}));
  });

  it("opsToJson merges the form over the current row rather than replacing unrelated keys", () => {
    const current = { prep_default_min: 22, some_future_key: "kept" };
    const next = opsToJson({ prep_default_min: 30 }, current);
    expect(next).toEqual({ prep_default_min: 30, some_future_key: "kept" });
  });
});

describe("parseKitchenStatus / kitchenStatusCapacityToJson", () => {
  it("reads capacity alongside paused/since without disturbing them on a capacity-only save", () => {
    const current = { paused: true, since: "2026-10-01T10:00:00Z", capacity: 8 };
    expect(parseKitchenStatus(current)).toEqual({ paused: true, since: "2026-10-01T10:00:00Z", capacity: 8 });
    const next = kitchenStatusCapacityToJson(12, current);
    expect(next).toEqual({ paused: true, since: "2026-10-01T10:00:00Z", capacity: 12 });
  });

  it("defaults capacity to undefined, not 0, when absent — the panel falls back to 8 itself", () => {
    expect(parseKitchenStatus({}).capacity).toBeUndefined();
  });
});

describe("parsePayments / parsePaymentsEnabled — read-only view, §D-011", () => {
  it("reads the seed shape including the nested payout object", () => {
    const v = parsePayments({ provider: "stripe", cash_on_delivery: true, payout: { iban_last4: null } });
    expect(v).toEqual({ provider: "stripe", cash_on_delivery: true, payout: { iban_last4: null } });
  });

  it("tolerates a missing payout object", () => {
    expect(parsePayments({ provider: "stripe" })).toEqual({ provider: "stripe", cash_on_delivery: undefined, payout: { iban_last4: null } });
  });

  it("reads methods/tip presets/capture", () => {
    const v = parsePaymentsEnabled({ methods: ["card", "cash"], tip_presets_cents: [0, 100, 200], capture: "on_delivery" });
    expect(v).toEqual({ methods: ["card", "cash"], tip_presets_cents: [0, 100, 200], capture: "on_delivery" });
  });
});

function row(over: Partial<StaffDirectoryRow> = {}): StaffDirectoryRow {
  return { id: "u1", name: "K. Sato", role: "owner", active: true, ...over };
}

describe("sortTeam (§6.9 row 2)", () => {
  it("active before inactive, then owner/operator/kitchen/driver, then name", () => {
    const rows = [
      row({ id: "d1", name: "Jonas M.", role: "driver" }),
      row({ id: "k1", name: "Lena N.", role: "kitchen", active: false }),
      row({ id: "o1", name: "Marek K.", role: "operator" }),
      row({ id: "ow2", name: "A. Owner", role: "owner" }),
    ];
    const sorted = sortTeam(rows);
    expect(sorted.map((r) => r.id)).toEqual(["ow2", "o1", "d1", "k1"]);
  });

  it("tolerates a null name/role from the view rather than throwing", () => {
    const rows = [row({ id: "x1", name: null, role: null })];
    expect(() => sortTeam(rows)).not.toThrow();
  });
});
