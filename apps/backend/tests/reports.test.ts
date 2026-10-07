import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, ITEM, openAllDay, rpc, signIn, type Db } from "./helpers";

beforeAll(openAllDay);

/**
 * §6.10 Berichte. The numbers are asserted exactly, so the fixture lives on a **fixed day in the
 * past** (no other suite touches it) and is inserted with the service role rather than through
 * place_order — the report functions read `orders` / `order_items` / `order_attempts` only.
 *
 * DAY = 2026-02-03 (Berlin, UTC+1). Fixture:
 *   A  delivery  delivered  zone A  total 2400  accepted 12:00 → completed 12:40 (40 min, promised 30 → overdue)
 *   B  pickup    picked_up  —       total 1000  accepted 13:00 → completed 13:20 (20 min, promised 30)
 *   C  delivery  cancelled  zone A  total 5000  (never completed)
 *   D  delivery  delivered  zone A  total 1600  accepted 14:00 → completed 14:25 (25 min, promised 30)
 * Items: A = 2 × ramen, unit 1350, line 3000 (→ 300 upsell) · B = 1 × ramen, line 1350 · D = 1 × udon, line 1100
 * Attempts: 3 rows, 2 of them with problems.
 */
const DAY = "2026-02-03";
const at = (hhmm: string) => `${DAY}T${hhmm}:00+01:00`;
const ZONE_A_CODE = "A";

type Fixture = { a: string; b: string; c: string; d: string; zoneA: string; phone: string };
let fx: Fixture;

async function seedFixture(): Promise<Fixture> {
  const a = admin();
  const { data: zone } = await a.from("delivery_zones").select("id").eq("code", ZONE_A_CODE).single();
  const zoneA = zone!.id as string;
  const phone = "+4917699000001";

  // idempotent: a re-run without `db reset` must not double-count
  await a.from("orders").delete().eq("contact_phone", phone);
  await a.from("order_attempts").delete().like("session_hash", "fx-%");
  await a.from("customers").delete().eq("phone", phone);
  const { data: cust, error: cErr } = await a.from("customers")
    .insert({ name: "Report Fixture", phone }).select("id").single();
  if (cErr) throw cErr;

  // PostgREST builds ONE insert from the union of all keys in the array and sends NULL — not
  // DEFAULT — for a key a row omits, so every row must carry the full column set explicitly.
  const base = {
    channel: "website", payment_method: "card", contact_name: "Report Fixture",
    contact_phone: phone, customer_id: cust!.id as string, promised_minutes: 30,
    zone_id: null as string | null, subtotal_cents: 0, discount_cents: 0, delivery_fee_cents: 0,
    tip_cents: 0, total_cents: 0, vat_cents: 0,
    accepted_at: null as string | null, completed_at: null as string | null,
    cancelled_at: null as string | null, cancel_reason: null as string | null,
  };
  const rows = [
    { ...base, type: "delivery", status: "delivered", payment_status: "paid", zone_id: zoneA,
      subtotal_cents: 2000, delivery_fee_cents: 300, tip_cents: 100, vat_cents: 200, total_cents: 2400,
      created_at: at("11:55"), accepted_at: at("12:00"), completed_at: at("12:40") },
    { ...base, type: "pickup", status: "picked_up", payment_status: "paid",
      subtotal_cents: 1000, vat_cents: 90, total_cents: 1000,
      created_at: at("12:55"), accepted_at: at("13:00"), completed_at: at("13:20") },
    { ...base, type: "delivery", status: "cancelled", payment_status: "pending", zone_id: zoneA,
      subtotal_cents: 5000, total_cents: 5000, cancel_reason: "test fixture",
      created_at: at("13:30"), cancelled_at: at("13:35") },
    { ...base, type: "delivery", status: "delivered", payment_status: "pending", zone_id: zoneA,
      subtotal_cents: 1600, vat_cents: 150, total_cents: 1600,
      created_at: at("13:55"), accepted_at: at("14:00"), completed_at: at("14:25") },
  ];
  const { error } = await a.from("orders").insert(rows as never);
  if (error) throw error;
  // re-read in fixture order: PostgREST does not guarantee the order of an insert's returning rows
  const { data: orders } = await a.from("orders").select("id").eq("contact_phone", phone).order("created_at");
  const [A, B, C, D] = orders!.map((o) => o.id as string);

  const { error: iErr } = await a.from("order_items").insert([
    { order_id: A, item_id: ITEM.ramen, name: "Tonkotsu Ramen", qty: 2, unit_price_cents: 1350, line_total_cents: 3000,
      options: [{ option: "Extra wasabi", price_cents: 150 }] },
    { order_id: B, item_id: ITEM.ramen, name: "Tonkotsu Ramen", qty: 1, unit_price_cents: 1350, line_total_cents: 1350,
      options: [] },
    { order_id: D, item_id: ITEM.udon, name: "Yaki Udon", qty: 1, unit_price_cents: 1100, line_total_cents: 1100,
      options: [] },
  ] as never);
  if (iErr) throw iErr;

  const { error: aErr } = await a.from("order_attempts").insert([
    { at: at("11:30"), type: "delivery", postal_code: "10115", zone_id: zoneA, subtotal_cents: 1200,
      items: [{ item_id: ITEM.ramen, qty: 1 }], problems: [{ code: "unavailable" }], session_hash: "fx-1" },
    { at: at("11:40"), type: "delivery", postal_code: "99999", zone_id: null, subtotal_cents: 900,
      items: [], problems: [{ code: "out_of_zone" }], session_hash: "fx-2" },
    { at: at("11:45"), type: "pickup", postal_code: null, zone_id: null, subtotal_cents: 500,
      items: [], problems: [], session_hash: "fx-3" },
  ] as never);
  if (aErr) throw aErr;

  return { a: A, b: B, c: C, d: D, zoneA, phone };
}

describe("reports (§6.10)", () => {
  let operator: Db;
  beforeAll(async () => {
    operator = await signIn("operator");
    fx = await seedFixture();
  });

  const range = { from_date: DAY, to_date: DAY };

  it("report_revenue_by_day splits delivery / pickup / upsell and reconciles", async () => {
    const { data, error } = await rpc(operator, "report_revenue_by_day", range);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      day: DAY,
      orders_count: 3,                    // A, B, D — the cancelled one is not revenue
      revenue_cents: 5000,                // 2400 + 1000 + 1600
      delivery_revenue_cents: 4000,       // 2400 + 1600
      pickup_revenue_cents: 1000,
      upsell_cents: 300,                  // A: 3000 − 1350 × 2
      delivery_fee_cents: 300,
      tip_cents: 100,
      vat_cents: 440,
      avg_basket_cents: 1666,             // 5000 / 3
      cancelled_count: 1,
      refunded_cents: 0,
    });
  });

  it("report_top_items gives quantity, revenue and margin per item", async () => {
    const { data, error } = await rpc(operator, "report_top_items", { ...range, limit_count: 10 });
    expect(error).toBeNull();
    const byId = Object.fromEntries((data as Record<string, unknown>[]).map((r) => [r.item_id, r]));

    const ramen = byId[ITEM.ramen];
    expect(ramen).toMatchObject({ qty: 3, orders_count: 2, revenue_cents: 4350 }); // 3000 + 1350
    const udon = byId[ITEM.udon];
    expect(udon).toMatchObject({ qty: 1, orders_count: 1, revenue_cents: 1100 });

    // margin = revenue − menu_items.cost_cents × qty (options have no cost in the schema)
    const { data: costs } = await admin().from("menu_items").select("id, cost_cents")
      .in("id", [ITEM.ramen, ITEM.udon]);
    const cost = Object.fromEntries(costs!.map((c) => [c.id, c.cost_cents as number]));
    expect(ramen.cost_cents).toBe(cost[ITEM.ramen] * 3);
    expect(ramen.margin_cents).toBe(4350 - cost[ITEM.ramen] * 3);
    expect(udon.margin_cents).toBe(1100 - cost[ITEM.udon] * 1);

    // shares are over the period's line revenue (4350 + 1100 = 5450)
    expect(Number(ramen.share_pct)).toBeCloseTo(79.8, 1);
    expect(Number(udon.share_pct)).toBeCloseTo(20.2, 1);

    // ordered by revenue, and the limit is honoured
    expect((data as Record<string, unknown>[])[0].item_id).toBe(ITEM.ramen);
    const { data: one } = await rpc(operator, "report_top_items", { ...range, limit_count: 1 });
    expect(one).toHaveLength(1);
  });

  it("report_funnel counts what it can and does not invent the rest", async () => {
    const { data, error } = await rpc(operator, "report_funnel", range);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      attempts: 3,
      attempts_with_problems: 2,
      placed: 4,                          // A, B, C, D were all created that day
      paid: 2,                            // A and B
      cancelled: 1,
      upsell_orders: 1,
      upsell_cents: 300,
    });
    expect(Number(data[0].placed_to_paid_pct)).toBeCloseTo(50.0, 1);
    // [S2-06] 133.3 % is the honest, legitimate ratio of a fully-comparable window: order_attempts
    // records only rejected/abandoned checkouts, so it is not bounded by `placed` — a window where
    // recording has existed the whole time is not clamped or suppressed just for exceeding 100.
    expect(Number(data[0].attempts_to_placed_pct)).toBeCloseTo(133.3, 1);
    // [S2-06] the window the ratio covers is reported back explicitly; this fixture day is at or
    // after the earliest order_attempts row in the whole suite, so it is not narrowed at all.
    expect(data[0].attempts_window_from).toBe(DAY);
    expect(data[0].attempts_window_to).toBe(DAY);
    // MENÜ → WARENKORB is deliberately absent — no menu-impression source exists (README "Reports")
    expect(data[0]).not.toHaveProperty("menu_to_cart_pct");
  });

  // [S2-06 task 8] The "200 %" defect: order_attempts only exists from 2026-09-26, orders go back
  // to S2-01 (2026-09-20) — a window reaching before recording began counted every pre-recording
  // order as "placed" against an attempts count that could not exist yet. These tests do not
  // assume a specific global earliest row (other suites insert their own); they read whatever it
  // actually is and build a window guaranteed to sit entirely before it, or to straddle it.
  describe("report_funnel: the pre-recording window is never blended into the ratio", () => {
    it("returns null attempts/ratio/window for a range entirely before any order_attempts row", async () => {
      const { data: earliestRows } = await admin().from("order_attempts")
        .select("at").order("at", { ascending: true }).limit(1);
      const earliest = earliestRows?.[0]?.at ? new Date(earliestRows[0].at as string) : new Date("2026-09-26T00:00:00Z");
      const windowEnd = new Date(earliest.getTime() - 1000 * 60 * 60 * 24 * 300);   // ~300 days earlier
      const windowStart = new Date(windowEnd.getTime() - 1000 * 60 * 60 * 24 * 5);  // a 5-day ancient window
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const from_date = iso(windowStart), to_date = iso(windowEnd);

      // a real, honestly-placed order inside that ancient window — models a pre-recording order
      const phone = "+4917699000099";
      await admin().from("orders").delete().eq("contact_phone", phone);
      await admin().from("customers").delete().eq("phone", phone);
      const { data: cust } = await admin().from("customers").insert({ name: "Ancient Fixture", phone }).select("id").single();
      await admin().from("orders").insert({
        channel: "website", type: "pickup", status: "delivered", payment_status: "paid", payment_method: "cash",
        contact_name: "Ancient Fixture", contact_phone: phone, customer_id: cust!.id, total_cents: 1000,
        created_at: `${from_date}T12:00:00+01:00`,
      } as never);

      const { data, error } = await rpc(operator, "report_funnel", { from_date, to_date });
      expect(error).toBeNull();
      expect(data[0].attempts).toBeNull();
      expect(data[0].attempts_with_problems).toBeNull();
      expect(data[0].attempts_to_placed_pct).toBeNull();
      expect(data[0].attempts_window_from).toBeNull();
      expect(data[0].attempts_window_to).toBeNull();
      // placed/paid/cancelled/upsell are pure `orders` queries and stay honest regardless
      expect(data[0].placed).toBeGreaterThan(0);
    });

    it("clamps the comparable sub-window to the earliest order_attempts row when the requested range spans across it", async () => {
      const { data: earliestRows } = await admin().from("order_attempts")
        .select("at").order("at", { ascending: true }).limit(1);
      expect(earliestRows!.length, "no order_attempts row exists anywhere — nothing to clamp to").toBeGreaterThan(0);
      const globalEarliestDate = new Date(earliestRows![0].at as string).toISOString().slice(0, 10);

      const from_date = "2020-01-01"; // certainly before any real attempt row
      const to_date = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString().slice(0, 10); // through tomorrow

      const { data, error } = await rpc(operator, "report_funnel", { from_date, to_date });
      expect(error).toBeNull();
      expect(data[0].attempts_window_from).toBe(globalEarliestDate);
      expect(data[0].attempts_window_to).toBe(to_date);
      // the sub-window starts at the clamp point, not at the requested from_date
      expect(data[0].attempts_window_from).not.toBe(from_date);
    });
  });

  it("report_delivery_times: per zone, promised vs actual, overdue share", async () => {
    const { data, error } = await rpc(operator, "report_delivery_times", range);
    expect(error).toBeNull();
    const rows = data as Record<string, unknown>[];

    const zoneA = rows.find((r) => r.zone_id === fx.zoneA)!;
    expect(zoneA).toMatchObject({ zone_code: "A", orders_count: 2, overdue_count: 1 });
    expect(Number(zoneA.avg_actual_minutes)).toBeCloseTo(32.5, 1);   // (40 + 25) / 2
    expect(Number(zoneA.avg_promised_minutes)).toBeCloseTo(30.0, 1);
    expect(Number(zoneA.delta_minutes)).toBeCloseTo(2.5, 1);
    expect(Number(zoneA.overdue_share_pct)).toBeCloseTo(50.0, 1);

    const pickup = rows.find((r) => r.zone_id === null)!;            // "Abholung"
    expect(pickup).toMatchObject({ orders_count: 1, overdue_count: 0 });
    expect(Number(pickup.avg_actual_minutes)).toBeCloseTo(20.0, 1);
  });

  it("the date range is inclusive on both ends and excludes everything outside it", async () => {
    const { data: before } = await rpc(operator, "report_revenue_by_day", { from_date: "2026-02-01", to_date: "2026-02-02" });
    expect(before).toEqual([]);
    const { data: around } = await rpc(operator, "report_revenue_by_day", { from_date: "2026-02-02", to_date: "2026-02-04" });
    expect(around).toHaveLength(1);
    expect(around[0]).toMatchObject({ day: DAY, revenue_cents: 5000 });
  });

  it("every active staff role may read the reports; anon may not", async () => {
    for (const role of ["owner", "operator", "kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { data, error } = await rpc(c, "report_revenue_by_day", range);
      expect(error, role).toBeNull();
      expect((data as unknown[]).length, role).toBe(1);
    }
    for (const fn of ["report_revenue_by_day", "report_top_items", "report_funnel", "report_delivery_times"]) {
      const { error } = await rpc(anon(), fn, range);
      expect(error, fn).not.toBeNull();     // execute is revoked from anon
    }
  });
});

/**
 * report_payments (§8.5, S2-06) — its own isolated fixture on a different day, deliberately not
 * sharing DAY = 2026-02-03 above: report_payments groups by (payment_method, payment_status)
 * regardless of order status, and a shared fixture's cancelled_count/revenue assertions above
 * would silently drift if this added another row to that same day.
 */
describe("report_payments (§8.5)", () => {
  const PDAY = "2026-04-04";
  const pat = (hhmm: string) => `${PDAY}T${hhmm}:00+01:00`;
  const pphone = "+4917699000050";
  let p1: string, p2: string, p3: string;

  beforeAll(async () => {
    const a = admin();
    await a.from("orders").delete().eq("contact_phone", pphone);
    await a.from("customers").delete().eq("phone", pphone);
    const { data: cust } = await a.from("customers").insert({ name: "Payments Fixture", phone: pphone }).select("id").single();

    const base = {
      channel: "website", type: "pickup", contact_name: "Payments Fixture", contact_phone: pphone,
      customer_id: cust!.id as string, subtotal_cents: 0, discount_cents: 0, delivery_fee_cents: 0,
      tip_cents: 0, vat_cents: 0, zone_id: null as string | null, promised_minutes: null as number | null,
      accepted_at: null as string | null, completed_at: null as string | null,
      cancelled_at: null as string | null, cancel_reason: null as string | null,
      payment_refunded_cents: 0,
    };
    const rows = [
      // card/paid, partially refunded
      { ...base, status: "delivered", payment_method: "card", payment_status: "paid",
        total_cents: 3000, payment_refunded_cents: 500, created_at: pat("10:00") },
      // card/paid, no refund
      { ...base, status: "delivered", payment_method: "card", payment_status: "paid",
        total_cents: 2000, created_at: pat("11:00") },
      // cash/paid — a different method entirely, proves the GROUP BY actually groups
      { ...base, status: "delivered", payment_method: "cash", payment_status: "paid",
        total_cents: 1500, created_at: pat("12:00") },
    ];
    const { error } = await a.from("orders").insert(rows as never);
    if (error) throw error;
    const { data: orders } = await a.from("orders").select("id").eq("contact_phone", pphone).order("created_at");
    [p1, p2, p3] = orders!.map((o) => o.id as string);

    // the "provider trail": one failed job on the refunded order, one done job on the other card
    // order (must NOT count toward failed_jobs_count) — neither touches the cash order at all.
    const { error: jErr } = await a.from("payment_jobs").insert([
      { order_id: p1, action: "refund", amount_cents: 500, status: "failed", last_error: "test fixture" },
      { order_id: p2, action: "capture", amount_cents: 2000, status: "done" },
    ] as never);
    if (jErr) throw jErr;
  });

  const prange = { from_date: PDAY, to_date: PDAY };

  it("groups by (payment_method, payment_status): counts, cents, refunded cents, failed jobs", async () => {
    const operator = await signIn("operator");
    const { data, error } = await rpc(operator, "report_payments", prange);
    expect(error).toBeNull();
    const rows = data as Record<string, unknown>[];

    const card = rows.find((r) => r.payment_method === "card" && r.payment_status === "paid")!;
    expect(card).toMatchObject({
      orders_count: 2, total_cents: 5000, refunded_cents: 500, failed_jobs_count: 1,
    });
    const cash = rows.find((r) => r.payment_method === "cash" && r.payment_status === "paid")!;
    expect(cash).toMatchObject({
      orders_count: 1, total_cents: 1500, refunded_cents: 0, failed_jobs_count: 0,
    });
    void p1; void p2; void p3;
  });

  it("owner and operator may call it; kitchen, driver and anon may not", async () => {
    for (const role of ["owner", "operator"] as const) {
      const c = await signIn(role);
      const { data, error } = await rpc(c, "report_payments", prange);
      expect(error, role).toBeNull();
      expect((data as unknown[]).length, role).toBeGreaterThan(0);
    }
    for (const role of ["kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { error } = await rpc(c, "report_payments", prange);
      // unlike the other four reports, kitchen/driver are rejected by report_payments' own inline
      // guard — the ACL grants `authenticated` execute (owner/operator must reach it too), so this
      // is `forbidden_for_role`, not a PostgREST permission error.
      expect(error?.message, role).toBe("forbidden_for_role");
    }
    const { error: anonErr } = await rpc(anon(), "report_payments", prange);
    expect(anonErr).not.toBeNull();   // execute is revoked from anon entirely
  });

  it("the date range is inclusive on both ends and excludes everything outside it", async () => {
    const operator = await signIn("operator");
    const { data: before } = await rpc(operator, "report_payments", { from_date: "2026-04-01", to_date: "2026-04-03" });
    expect((before as unknown[] | null)?.some((r) => (r as Record<string, unknown>).payment_method === "cash")).toBeFalsy();
    const { data: around } = await rpc(operator, "report_payments", { from_date: "2026-04-03", to_date: "2026-04-05" });
    const rows = around as Record<string, unknown>[];
    expect(rows.some((r) => r.payment_method === "cash")).toBe(true);
  });
});

describe("customer_stats (§1.3, §6.9 row 8)", () => {
  it("counts completed orders only and reports cancelled separately", async () => {
    const a = admin();
    const { data: cust } = await a.from("customers").select("id").eq("phone", fx.phone).single();
    const { data: stats, error } = await a.from("customer_stats").select("*").eq("customer_id", cust!.id).single();
    expect(error).toBeNull();
    // fixture: 2 delivered (2400 + 1600) + 1 picked_up (1000) + 1 cancelled (5000)
    expect(stats).toMatchObject({
      orders_count: 3,
      spent_cents: 5000,
      avg_cents: 1667,      // avg(1666.67) cast to integer rounds; report_revenue_by_day divides
      cancelled_count: 1,
    });
    expect(stats!.last_order_at).toBeTruthy();
  });

  it("a `new` order does not count yet (the old view counted it)", async () => {
    const a = admin();
    const phone = "+4917699000002";
    await a.from("customers").delete().eq("phone", phone);
    const { data: cust } = await a.from("customers").insert({ name: "Only New", phone }).select("id").single();
    await a.from("orders").insert({
      channel: "website", type: "pickup", status: "new", payment_status: "pending", payment_method: "cash",
      contact_name: "Only New", contact_phone: phone, customer_id: cust!.id, total_cents: 1234,
    } as never);
    const { data: stats } = await a.from("customer_stats").select("*").eq("customer_id", cust!.id).single();
    expect(stats).toMatchObject({ orders_count: 0, spent_cents: 0, cancelled_count: 0 });
    expect(stats!.last_order_at).toBeNull();
    expect(stats!.days_silent).toBeNull();
  });

  it("the five columns §6.4 consumers already read are still there", async () => {
    const operator = await signIn("operator");
    const { data, error } = await operator.from("customer_stats")
      .select("customer_id, orders_count, spent_cents, avg_cents, last_order_at, days_silent, cancelled_count")
      .limit(1);
    expect(error).toBeNull();
    expect(data!.length).toBe(1);
  });
});
