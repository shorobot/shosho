// Pure Berichte logic: KPI aggregation, the funnel's two honest gaps (D-015, §6.9 row 5), and the
// XLSX export rows. No I/O here — the RPC calls live in lib/reportsStore.tsx. Everything here is
// unit-tested in tests/reports.test.ts.
import { dayKey, TZ } from "@/lib/time";
import type { DeliveryTimeRow, FunnelRow, PaymentReportRow, RevenueByDayRow, TopItemRow } from "@/lib/types";

export { TZ };

/**
 * A figure is either a number or a stated reason there is no number — the same convention
 * `lib/marketing.ts`'s `Kpi` uses. Rendering an unavailable figure as `0` or `0 %` is the specific
 * dishonesty D-015 and §6.9 row 5 forbid: "no sales" and "nothing recorded yet" are different claims.
 */
export type Report = { value: number; unit: "cents" | "count" | "pct" } | { unavailable: ReportReason };
export type ReportReason =
  | "no_data" // the window has no rows at all
  | "not_collected" // D-015 — no client-side analytics exist or are planned; this cannot ever have a value
  | "not_recorded_yet" // §6.9 row 5 — record_order_attempt has no caller yet (S3-03); the query is real, the data is not
  | "no_payments_yet" // no Stripe account has ever run on this project (§8.5); every row reads zero
  | "forbidden"; // report_payments is owner/operator only — defensive, the route guard should already prevent this

export function isAvailable(r: Report): r is { value: number; unit: "cents" | "count" | "pct" } {
  return "value" in r;
}

export type PeriodRange = { from: string; to: string }; // YYYY-MM-DD, Europe/Berlin, both ends inclusive

export const DEFAULT_WINDOW_DAYS = 30;

/** Last `days` Berlin calendar days, both ends inclusive — the same default the RPCs use server-side. */
export function defaultRange(now: Date, days = DEFAULT_WINDOW_DAYS): PeriodRange {
  const to = dayKey(now);
  const from = dayKey(new Date(now.getTime() - (days - 1) * 86400000));
  return { from, to };
}

export type TopLineKpis = {
  orders: Report;
  revenue: Report;
  avgTicket: Report;
  cancelledPct: Report;
};

/**
 * The KPI row, aggregated from `report_revenue_by_day`'s per-day rows (api-contracts §6.10).
 *
 * `orders_count` is every order created that day, any final status — `cancelled_count` sits next to
 * it "so a sum row reconciles against the bank", which only makes sense if it is not already
 * subtracted out. `revenue_cents` is completed orders only (delivered/picked_up); refunded orders
 * stay in it (their own `refunded_cents` is disclosed separately for reconciliation). Average ticket
 * therefore uses `orders_count − cancelled_count` as the denominator — orders that were not
 * cancelled — since the contract names no narrower "completed" count to divide by exactly.
 */
export function topLineKpis(rows: RevenueByDayRow[]): TopLineKpis {
  if (rows.length === 0) {
    return { orders: { unavailable: "no_data" }, revenue: { unavailable: "no_data" }, avgTicket: { unavailable: "no_data" }, cancelledPct: { unavailable: "no_data" } };
  }
  const orders = rows.reduce((s, r) => s + r.orders_count, 0);
  const revenue = rows.reduce((s, r) => s + r.revenue_cents, 0);
  const cancelled = rows.reduce((s, r) => s + r.cancelled_count, 0);
  const notCancelled = orders - cancelled;
  return {
    orders: { value: orders, unit: "count" },
    revenue: { value: revenue, unit: "cents" },
    avgTicket: notCancelled > 0 ? { value: Math.round(revenue / notCancelled), unit: "cents" } : { unavailable: "no_data" },
    cancelledPct: orders > 0 ? { value: (cancelled / orders) * 100, unit: "pct" } : { unavailable: "no_data" },
  };
}

/**
 * The funnel's four honest states (D-015 / §6.9 row 5 / S2-06's window fix):
 *   - `cartStep` ("MENÜ → WARENKORB"): permanently unavailable — no `site_events` exists or is
 *     planned (D-015). Not a loading state; it can never resolve.
 *   - `attempts`: unavailable until `attempts_window_from/to` come back non-null — meaning either
 *     nothing has called `record_order_attempt` yet (S3-03), or the requested range has no overlap
 *     with the period `order_attempts` has existed for at all. The caller should show
 *     `attemptsWindow` (the sub-range the ratio actually covers) whenever it is narrower than what
 *     was asked for, so a figure never silently answers a different question than the one on screen.
 *   - `checkout` / `upsell`: real, straight from `orders` — always available once there are any rows.
 */
export type FunnelView = {
  cartStep: { unavailable: "not_collected" };
  attempts: Report;
  attemptsWithProblems: Report;
  attemptsToPlacedPct: Report;
  /** The sub-range `attemptsToPlacedPct` actually covers, when narrower than the request — null if there is no overlap at all. */
  attemptsWindow: PeriodRange | null;
  placed: Report;
  paid: Report;
  placedToPaidPct: Report;
  cancelled: Report;
  upsellOrders: Report;
  upsellCents: Report;
};

export function funnelView(row: FunnelRow | null): FunnelView {
  const cartStep = { unavailable: "not_collected" as const };
  if (!row) {
    const noData: Report = { unavailable: "no_data" };
    return {
      cartStep, attempts: noData, attemptsWithProblems: noData, attemptsToPlacedPct: noData, attemptsWindow: null,
      placed: noData, paid: noData, placedToPaidPct: noData, cancelled: noData, upsellOrders: noData, upsellCents: noData,
    };
  }
  const notRecorded: Report = { unavailable: "not_recorded_yet" };
  const hasWindow = row.attempts_window_from != null && row.attempts_window_to != null;
  return {
    cartStep,
    attempts: hasWindow ? { value: row.attempts, unit: "count" } : notRecorded,
    attemptsWithProblems: hasWindow ? { value: row.attempts_with_problems, unit: "count" } : notRecorded,
    attemptsToPlacedPct: hasWindow ? { value: row.attempts_to_placed_pct, unit: "pct" } : notRecorded,
    attemptsWindow: hasWindow ? { from: dayKey(new Date(row.attempts_window_from)), to: dayKey(new Date(row.attempts_window_to)) } : null,
    placed: { value: row.placed, unit: "count" },
    paid: { value: row.paid, unit: "count" },
    placedToPaidPct: { value: row.placed_to_paid_pct, unit: "pct" },
    cancelled: { value: row.cancelled, unit: "count" },
    upsellOrders: { value: row.upsell_orders, unit: "count" },
    upsellCents: { value: row.upsell_cents, unit: "cents" },
  };
}

/** True once the requested range narrowed to a sub-window — the caller should say so next to the ratio. */
export function attemptsWindowNarrowed(requested: PeriodRange, actual: PeriodRange | null): boolean {
  return actual != null && (actual.from !== requested.from || actual.to !== requested.to);
}

/**
 * `report_payments` (§8.5, owner/operator only). Two states beyond "has rows":
 *   - `forbidden`: the RPC itself refused (42501) — defensive; the route guard should already keep
 *     kitchen/driver off this screen entirely, per §8.5's narrower-than-the-other-four guard.
 *   - `no_payments_yet`: the call succeeded and returned rows, but every one reads zero — no Stripe
 *     account has ever run on this project. Rendered as "no payment data yet", never as €0.00: a
 *     zero reads as "no sales", a different and alarming claim than "nothing has been charged".
 */
export type PaymentsView = { ok: true; rows: PaymentReportRow[]; allZero: boolean } | { ok: false; reason: "forbidden" };

export function paymentsView(rows: PaymentReportRow[] | null, error: { code?: string } | null): PaymentsView {
  if (error) return { ok: false, reason: "forbidden" };
  const all = rows ?? [];
  const allZero = all.length === 0 || all.every((r) => r.orders_count === 0 && r.total_cents === 0 && r.refunded_cents === 0 && r.failed_jobs_count === 0);
  return { ok: true, rows: all, allZero };
}

/** Delivery-time rows: pickup/unzoned arrives with `zone_id = null` and should sort last, named "Abholung". */
export function sortDeliveryTimes(rows: DeliveryTimeRow[]): DeliveryTimeRow[] {
  return [...rows].sort((a, b) => {
    if (a.zone_id == null) return 1;
    if (b.zone_id == null) return -1;
    return (a.zone_code ?? "").localeCompare(b.zone_code ?? "");
  });
}

/** Top items are already revenue-desc from the RPC; re-exported here only so callers don't reach past this module. */
export function topItems(rows: TopItemRow[]): TopItemRow[] {
  return rows;
}
