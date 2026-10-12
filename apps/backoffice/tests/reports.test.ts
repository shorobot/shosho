// BO · Berichte logic (api-contracts §6.10 / §8.5). The two groups that matter most: the funnel's
// two honest gaps (D-015's permanent "not collected", §6.9 row 5's "nothing recorded yet" that must
// resolve once S3-03 ships) and report_payments's "no data yet" vs €0,00 distinction (§8.5).
import { describe, expect, it } from "vitest";
import {
  attemptsWindowNarrowed, defaultRange, funnelView, isAvailable, paymentsView, sortDeliveryTimes, topLineKpis,
} from "@/lib/reports";
import type { DeliveryTimeRow, FunnelRow, PaymentReportRow, RevenueByDayRow } from "@/lib/types";

function revenueDay(over: Partial<RevenueByDayRow> = {}): RevenueByDayRow {
  return {
    day: "2026-10-01", orders_count: 10, revenue_cents: 20000, delivery_revenue_cents: 15000, pickup_revenue_cents: 5000,
    upsell_cents: 1000, delivery_fee_cents: 2000, tip_cents: 500, discount_cents: 1000, vat_cents: 1400,
    avg_basket_cents: 2000, cancelled_count: 1, refunded_cents: 0, ...over,
  };
}

// The generated types declare `attempts_window_from/to` and `zone_code/zone_name` as plain
// `string` — api-contracts §6.10 is explicit that both come back SQL NULL (surfaced by supabase-js
// as `null`) when there is no overlap / the row is the pickup zone; the generator just doesn't model
// function-return nullability. These factories widen only those fields so a fixture can say so.
type FunnelRowOverride = Partial<Omit<FunnelRow, "attempts_window_from" | "attempts_window_to">> & {
  attempts_window_from?: string | null;
  attempts_window_to?: string | null;
};
type DeliveryTimeRowOverride = Partial<Omit<DeliveryTimeRow, "zone_id" | "zone_code" | "zone_name">> & {
  zone_id?: string | null;
  zone_code?: string | null;
  zone_name?: string | null;
};

function funnelRow(over: FunnelRowOverride = {}): FunnelRow {
  return {
    attempts: 5, attempts_with_problems: 2, placed: 40, paid: 38, cancelled: 2,
    attempts_to_placed_pct: 12.5, placed_to_paid_pct: 95, upsell_orders: 10, upsell_cents: 3000,
    attempts_window_from: "2026-09-26", attempts_window_to: "2026-10-01", ...over,
  } as FunnelRow;
}

function paymentRow(over: Partial<PaymentReportRow> = {}): PaymentReportRow {
  return { payment_method: "card", payment_status: "paid", orders_count: 5, total_cents: 10000, refunded_cents: 0, failed_jobs_count: 0, ...over };
}

function zone(over: DeliveryTimeRowOverride = {}): DeliveryTimeRow {
  return { zone_id: "z1", zone_code: "A", zone_name: "Mitte", orders_count: 10, avg_actual_minutes: 30, avg_promised_minutes: 32, delta_minutes: -2, overdue_count: 1, overdue_share_pct: 10, ...over } as DeliveryTimeRow;
}

describe("defaultRange", () => {
  it("is 30 Berlin days, both ends inclusive", () => {
    const r = defaultRange(new Date("2026-10-12T10:00:00Z"));
    expect(r.to).toBe("2026-10-12");
    expect(r.from).toBe("2026-09-13");
  });
});

describe("topLineKpis", () => {
  it("aggregates across the window and derives avg ticket from orders minus cancelled", () => {
    const k = topLineKpis([revenueDay({ orders_count: 10, revenue_cents: 20000, cancelled_count: 1 }), revenueDay({ day: "2026-10-02", orders_count: 8, revenue_cents: 16000, cancelled_count: 0 })]);
    expect(isAvailable(k.orders) && k.orders.value).toBe(18);
    expect(isAvailable(k.revenue) && k.revenue.value).toBe(36000);
    // revenue 36000 / (18 orders - 1 cancelled) = 36000/17 = 2117.6 -> rounds to 2118
    expect(isAvailable(k.avgTicket) && k.avgTicket.value).toBe(2118);
    expect(isAvailable(k.cancelledPct) && k.cancelledPct.value).toBeCloseTo((1 / 18) * 100, 5);
  });

  it("is unavailable, not zero, for an empty window", () => {
    const k = topLineKpis([]);
    expect(isAvailable(k.orders)).toBe(false);
    expect(isAvailable(k.revenue)).toBe(false);
    expect(isAvailable(k.avgTicket)).toBe(false);
    expect(isAvailable(k.cancelledPct)).toBe(false);
  });

  it("avg ticket is unavailable rather than Infinity/NaN when every order was cancelled", () => {
    const k = topLineKpis([revenueDay({ orders_count: 3, revenue_cents: 0, cancelled_count: 3 })]);
    expect(isAvailable(k.avgTicket)).toBe(false);
  });
});

// D-015 / §6.9 row 5 — the funnel's two honest gaps.
describe("funnelView", () => {
  it("MENÜ → WARENKORB is always unavailable, permanently, by construction", () => {
    const v = funnelView(funnelRow());
    expect(v.cartStep).toEqual({ unavailable: "not_collected" });
    expect(funnelView(null).cartStep).toEqual({ unavailable: "not_collected" });
  });

  it("attempts resolve once attempts_window_from/to are non-null", () => {
    const v = funnelView(funnelRow());
    expect(isAvailable(v.attempts) && v.attempts.value).toBe(5);
    expect(isAvailable(v.attemptsToPlacedPct) && v.attemptsToPlacedPct.value).toBe(12.5);
    expect(v.attemptsWindow).toEqual({ from: "2026-09-26", to: "2026-10-01" });
  });

  it("attempts read 'not recorded yet' — not 0 — when the window columns come back null (S3-03 hasn't shipped, or no overlap)", () => {
    const v = funnelView(funnelRow({ attempts_window_from: null, attempts_window_to: null }));
    expect(v.attempts).toEqual({ unavailable: "not_recorded_yet" });
    expect(v.attemptsWithProblems).toEqual({ unavailable: "not_recorded_yet" });
    expect(v.attemptsToPlacedPct).toEqual({ unavailable: "not_recorded_yet" });
    expect(v.attemptsWindow).toBeNull();
  });

  it("placed/paid/cancelled/upsell stay real and available regardless of the attempts window", () => {
    const v = funnelView(funnelRow({ attempts_window_from: null, attempts_window_to: null }));
    expect(isAvailable(v.placed) && v.placed.value).toBe(40);
    expect(isAvailable(v.paid) && v.paid.value).toBe(38);
    expect(isAvailable(v.upsellCents) && v.upsellCents.value).toBe(3000);
  });

  it("a null row (RPC returned no rows at all) reads as no_data, not a crash", () => {
    const v = funnelView(null);
    expect(v.placed).toEqual({ unavailable: "no_data" });
  });
});

describe("attemptsWindowNarrowed", () => {
  it("true only when the actual window differs from what was requested", () => {
    const requested = { from: "2026-09-01", to: "2026-10-01" };
    expect(attemptsWindowNarrowed(requested, { from: "2026-09-26", to: "2026-10-01" })).toBe(true);
    expect(attemptsWindowNarrowed(requested, { from: "2026-09-01", to: "2026-10-01" })).toBe(false);
    expect(attemptsWindowNarrowed(requested, null)).toBe(false);
  });
});

// §8.5 — "no payment data yet" must never render as €0,00, which is a different (alarming) claim.
describe("paymentsView", () => {
  it("forbidden when the RPC itself was refused", () => {
    const v = paymentsView(null, { code: "42501" });
    expect(v).toEqual({ ok: false, reason: "forbidden" });
  });

  it("allZero when every row reads zero — no Stripe account has ever run", () => {
    const v = paymentsView([paymentRow({ orders_count: 0, total_cents: 0, refunded_cents: 0, failed_jobs_count: 0 }), paymentRow({ payment_method: "cash", payment_status: "pending", orders_count: 0, total_cents: 0, refunded_cents: 0, failed_jobs_count: 0 })], null);
    expect(v.ok && v.allZero).toBe(true);
  });

  it("allZero when the RPC returned zero rows", () => {
    const v = paymentsView([], null);
    expect(v.ok && v.allZero).toBe(true);
  });

  it("not allZero once real money shows up anywhere in the rows", () => {
    const v = paymentsView([paymentRow({ payment_method: "cash", orders_count: 3, total_cents: 7500 })], null);
    expect(v.ok && v.allZero).toBe(false);
    expect(v.ok && v.rows).toHaveLength(1);
  });
});

describe("sortDeliveryTimes", () => {
  it("sorts by zone_code and always puts the pickup/unzoned row (zone_id = null) last", () => {
    const rows = [zone({ zone_id: null, zone_code: null, zone_name: "Abholung" }), zone({ zone_id: "z2", zone_code: "B" }), zone({ zone_id: "z1", zone_code: "A" })];
    const sorted = sortDeliveryTimes(rows);
    expect(sorted.map((r) => r.zone_code ?? "pickup")).toEqual(["A", "B", "pickup"]);
  });
});
