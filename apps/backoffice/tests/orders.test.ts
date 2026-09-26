import { describe, expect, it } from "vitest";
import {
  actionsFor, applyFilters, avgPrepMinutes, cashToCollect, groupOrders, inProgressStats, isPreorderPending, kitchenLoad, kpis,
  matchesSearch, timerFor, transitionAllowed, upsertOrder,
} from "@/lib/orders";
import type { Order, OrderStatus } from "@/lib/types";
import { dayKey, elapsedLabel, startOfDay, scheduleLabel } from "@/lib/time";
import { toCsv } from "@/lib/csv";

// 2026-09-21 19:00 Berlin (CEST = UTC+2) → 17:00Z
const NOW = new Date("2026-09-21T17:00:00Z");
const iso = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60000).toISOString();

let seq = 2400;
function order(p: Partial<Order> = {}): Order {
  seq++;
  return {
    id: `id-${seq}`,
    number: seq,
    channel: "website",
    type: "delivery",
    status: "new",
    payment_status: "paid",
    payment_method: "card",
    payment_ref: "Visa ···4417",
    customer_id: null,
    contact_name: "Anna Weber",
    contact_phone: "+49 151 22 44 880",
    address: { street: "Torstraße 128", floor_apt: "2. OG", postal_code: "10119", city: "Berlin" },
    zone_id: null,
    distance_km: 1.4,
    courier_comment: null,
    comment_flags: [],
    allergy_note: null,
    scheduled_for: null,
    promised_minutes: 22,
    accepted_at: null,
    accepted_by: null,
    preparing_at: null,
    ready_at: null,
    driver_id: null,
    out_at: null,
    completed_at: null,
    cancelled_at: null,
    cancel_reason: null,
    subtotal_cents: 3450,
    discount_cents: 0,
    delivery_fee_cents: 0,
    tip_cents: 0,
    total_cents: 3450,
    vat_cents: 226,
    promo_code: null,
    tracking_token: "tok",
    created_at: iso(1),
    updated_at: iso(1),
    order_items: [],
    order_events: [],
    ...p,
  };
}

describe("groupOrders", () => {
  it("splits into the four columns", () => {
    const rows = [
      order({ status: "new" }),
      order({ status: "preparing", preparing_at: iso(5) }),
      order({ status: "out_for_delivery", out_at: iso(10) }),
      order({ status: "delivered", completed_at: iso(30) }),
      order({ status: "cancelled", cancelled_at: iso(40) }),
      order({ status: "new", scheduled_for: new Date(NOW.getTime() + 120 * 60000).toISOString() }),
    ];
    const g = groupOrders(rows, NOW);
    expect(g.inProgress.map((o) => o.status)).toEqual(["new", "preparing"]);
    expect(g.onTheWay).toHaveLength(1);
    expect(g.doneToday.map((o) => o.status)).toEqual(["delivered", "cancelled"]);
    expect(g.preorders).toHaveLength(1);
  });

  it("moves a pre-order into In Arbeit inside the lead window and once it is cooking", () => {
    const soon = order({ status: "accepted", scheduled_for: new Date(NOW.getTime() + 30 * 60000).toISOString() });
    const cooking = order({ status: "preparing", scheduled_for: new Date(NOW.getTime() + 300 * 60000).toISOString() });
    const later = order({ status: "accepted", scheduled_for: new Date(NOW.getTime() + 300 * 60000).toISOString() });
    expect(isPreorderPending(soon, NOW)).toBe(false);
    expect(isPreorderPending(cooking, NOW)).toBe(false);
    expect(isPreorderPending(later, NOW)).toBe(true);
    const g = groupOrders([soon, cooking, later], NOW);
    expect(g.inProgress).toHaveLength(2);
    expect(g.preorders).toHaveLength(1);
  });

  it("keeps yesterday's completed orders out of Erledigt heute", () => {
    const yesterday = order({ status: "delivered", completed_at: new Date(NOW.getTime() - 26 * 3600000).toISOString() });
    expect(groupOrders([yesterday], NOW).doneToday).toHaveLength(0);
  });

  it("sorts In Arbeit new-first then by age, pre-orders by slot", () => {
    const a = order({ status: "preparing", created_at: iso(30), preparing_at: iso(5) });
    const b = order({ status: "new", created_at: iso(2) });
    const c = order({ status: "new", created_at: iso(4) });
    const g = groupOrders([a, b, c], NOW);
    expect(g.inProgress.map((o) => o.id)).toEqual([c.id, b.id, a.id]);
    const p1 = order({ status: "new", scheduled_for: new Date(NOW.getTime() + 200 * 60000).toISOString() });
    const p2 = order({ status: "new", scheduled_for: new Date(NOW.getTime() + 100 * 60000).toISOString() });
    expect(groupOrders([p1, p2], NOW).preorders.map((o) => o.id)).toEqual([p2.id, p1.id]);
  });
});

describe("search & filters", () => {
  const o = order({ number: 2418, contact_name: "Anna Weber", contact_phone: "+49 151 22 44 880" });
  it("matches number, name, phone and street", () => {
    expect(matchesSearch(o, "2418")).toBe(true);
    expect(matchesSearch(o, "#2418")).toBe(true);
    expect(matchesSearch(o, "weber")).toBe(true);
    expect(matchesSearch(o, "1512244")).toBe(true);
    expect(matchesSearch(o, "torstr")).toBe(true);
    expect(matchesSearch(o, "10119")).toBe(true);
    expect(matchesSearch(o, "Weber 2418")).toBe(true);
    expect(matchesSearch(o, "Mendes")).toBe(false);
    expect(matchesSearch(o, "  ")).toBe(true);
  });
  it("filter chips", () => {
    const rows = [
      order({ type: "delivery", payment_status: "paid" }),
      order({ type: "pickup", payment_status: "pending" }),
      order({ type: "pickup", payment_status: "authorized", scheduled_for: iso(-60) }),
      order({ type: "delivery", payment_status: "failed" }),
    ];
    expect(applyFilters(rows, "", "all")).toHaveLength(4);
    expect(applyFilters(rows, "", "delivery")).toHaveLength(2);
    expect(applyFilters(rows, "", "pickup")).toHaveLength(2);
    expect(applyFilters(rows, "", "paid")).toHaveLength(2);
    expect(applyFilters(rows, "", "open")).toHaveLength(2);
    expect(applyFilters(rows, "", "scheduled")).toHaveLength(1);
  });
});

describe("kpis", () => {
  it("counts today's orders, revenue without cancellations, avg delivery and cancel rate", () => {
    const rows = [
      order({ status: "delivered", total_cents: 4120, created_at: iso(50), completed_at: iso(3) }),
      order({ status: "delivered", total_cents: 2000, created_at: iso(60), completed_at: iso(20) }),
      order({ status: "cancelled", total_cents: 999, created_at: iso(10), cancelled_at: iso(5) }),
      order({ status: "new", total_cents: 1000 }),
      order({ status: "delivered", total_cents: 9999, created_at: new Date(NOW.getTime() - 30 * 3600000).toISOString(), completed_at: new Date(NOW.getTime() - 29 * 3600000).toISOString() }),
    ];
    const k = kpis(rows, NOW);
    expect(k.orders).toBe(4);
    expect(k.revenueCents).toBe(7120);
    expect(k.avgTicketCents).toBe(Math.round(7120 / 3));
    expect(k.avgDeliveryMin).toBe(Math.round((47 + 40) / 2));
    expect(k.cancelled).toBe(1);
    expect(k.cancelledPct).toBe(25);
  });
  it("empty day", () => {
    const k = kpis([], NOW);
    expect(k.avgTicketCents).toBeNull();
    expect(k.avgDeliveryMin).toBeNull();
    expect(k.cancelledPct).toBeNull();
  });
});

describe("timers", () => {
  it("new → waiting, escalates", () => {
    expect(timerFor(order({ created_at: iso(0.5) }), NOW)).toMatchObject({ kind: "waiting", urgency: "normal" });
    expect(timerFor(order({ created_at: iso(1.5) }), NOW)).toMatchObject({ kind: "waiting", urgency: "warn" });
    expect(timerFor(order({ created_at: iso(4) }), NOW)).toMatchObject({ kind: "waiting", urgency: "critical" });
  });
  it("preparing → elapsed / promised, overdue", () => {
    const t = timerFor(order({ status: "preparing", preparing_at: iso(14), promised_minutes: 22 }), NOW);
    expect(t).toMatchObject({ kind: "cooking", elapsedMin: 14, promisedMin: 22, overdue: false, urgency: "normal" });
    expect(timerFor(order({ status: "preparing", preparing_at: iso(16), promised_minutes: 22 }), NOW)).toMatchObject({ urgency: "warn" });
    expect(timerFor(order({ status: "preparing", preparing_at: iso(25), promised_minutes: 22 }), NOW)).toMatchObject({ overdue: true, urgency: "critical", progress: 1 });
  });
  it("ready → standing", () => {
    expect(timerFor(order({ status: "ready", ready_at: iso(4) }), NOW)).toMatchObject({ kind: "standing", min: 4, urgency: "normal" });
    expect(timerFor(order({ status: "ready", ready_at: iso(12) }), NOW)).toMatchObject({ kind: "standing", min: 12, urgency: "critical" });
  });
  it("out_for_delivery → eta from preparing_at + promised", () => {
    const t = timerFor(order({ status: "out_for_delivery", preparing_at: iso(30), promised_minutes: 45 }), NOW);
    expect(t.kind).toBe("eta");
    if (t.kind === "eta") expect(t.at?.toISOString()).toBe(new Date(NOW.getTime() + 15 * 60000).toISOString());
  });
  it("inProgressStats counts new + overdue", () => {
    const rows = [order({ status: "new" }), order({ status: "preparing", preparing_at: iso(30), promised_minutes: 22 })];
    expect(inProgressStats(rows, NOW)).toEqual({ newCount: 1, overdue: 1 });
  });
  it("elapsedLabel formats m:ss", () => {
    expect(elapsedLabel(new Date(NOW.getTime() - 42000).toISOString(), NOW)).toBe("0:42");
    expect(elapsedLabel(new Date(NOW.getTime() - 65000).toISOString(), NOW)).toBe("1:05");
    expect(elapsedLabel(new Date(NOW.getTime() - 3700000).toISOString(), NOW)).toBe("1:01 h");
    expect(elapsedLabel(new Date(NOW.getTime() - 3 * 86400000).toISOString(), NOW)).toBe("3 d");
  });
});

describe("status machine", () => {
  it("mirrors order_transition_allowed", () => {
    expect(transitionAllowed("new", "accepted", "delivery", "paid")).toBe(true);
    expect(transitionAllowed("new", "preparing", "delivery", "paid")).toBe(false);
    expect(transitionAllowed("ready", "out_for_delivery", "pickup", "paid")).toBe(false);
    expect(transitionAllowed("ready", "picked_up", "pickup", "paid")).toBe(true);
    expect(transitionAllowed("delivered", "refunded", "delivery", "paid")).toBe(true);
    expect(transitionAllowed("delivered", "refunded", "delivery", "pending")).toBe(false);
    expect(transitionAllowed("cancelled", "accepted", "delivery", "paid")).toBe(false);
  });

  const cases: [OrderStatus, "delivery" | "pickup", string[]][] = [
    ["new", "delivery", ["accept", "reject"]],
    ["accepted", "delivery", ["start", "cancel"]],
    ["preparing", "delivery", ["ready", "cancel"]],
    ["ready", "delivery", ["hand_to_driver", "cancel"]],
    ["ready", "pickup", ["handed_out", "cancel"]],
    ["out_for_delivery", "delivery", ["delivered", "cancel"]],
    ["delivered", "delivery", ["refund"]],
    ["cancelled", "delivery", []],
  ];
  it.each(cases)("operator buttons for %s / %s", (status, type, ids) => {
    const o = order({ status, type, payment_status: "paid" });
    expect(actionsFor(o, "operator").map((a) => a.id)).toEqual(ids);
    expect(actionsFor(o, "owner").map((a) => a.id)).toEqual(ids);
  });

  it("kitchen sees only start / ready", () => {
    expect(actionsFor(order({ status: "new" }), "kitchen")).toEqual([]);
    expect(actionsFor(order({ status: "accepted" }), "kitchen").map((a) => a.id)).toEqual(["start"]);
    expect(actionsFor(order({ status: "preparing" }), "kitchen").map((a) => a.id)).toEqual(["ready"]);
    expect(actionsFor(order({ status: "ready" }), "kitchen")).toEqual([]);
  });

  it("driver sees delivered only on own orders", () => {
    const mine = order({ status: "out_for_delivery", driver_id: "me" });
    expect(actionsFor(mine, "driver", "me").map((a) => a.id)).toEqual(["delivered"]);
    expect(actionsFor(mine, "driver", "someone-else")).toEqual([]);
    expect(actionsFor(order({ status: "ready", driver_id: "me" }), "driver", "me")).toEqual([]);
  });

  it("no refund on an unpaid completed order", () => {
    expect(actionsFor(order({ status: "picked_up", payment_status: "pending" }), "operator")).toEqual([]);
  });
});

describe("misc", () => {
  it("cash to collect only for unpaid cash", () => {
    expect(cashToCollect(order({ payment_method: "cash", payment_status: "pending", total_cents: 2740 }))).toBe(2740);
    expect(cashToCollect(order({ payment_method: "cash", payment_status: "paid" }))).toBeNull();
    expect(cashToCollect(order({ payment_method: "card", payment_status: "pending" }))).toBeNull();
  });
  it("kitchen load + avg prep", () => {
    const rows = [order({ status: "accepted" }), order({ status: "preparing" }), order({ status: "preparing", preparing_at: iso(30), ready_at: iso(12) })];
    expect(kitchenLoad(rows, 8)).toBe(38);
    expect(avgPrepMinutes(rows, NOW)).toBe(18);
  });
  it("upsertOrder replaces, inserts, removes", () => {
    const a = order();
    const b = order();
    const list = upsertOrder([a], b, b.id);
    expect(list).toHaveLength(2);
    expect(upsertOrder(list, { ...a, status: "accepted" }, a.id).find((o) => o.id === a.id)?.status).toBe("accepted");
    expect(upsertOrder(list, null, a.id)).toHaveLength(1);
  });
  it("Berlin day boundaries", () => {
    expect(dayKey(new Date("2026-09-21T22:30:00Z"))).toBe("2026-09-22");
    expect(startOfDay(new Date("2026-09-21T22:30:00Z")).toISOString()).toBe("2026-09-21T22:00:00.000Z");
    expect(startOfDay(new Date("2026-01-10T12:00:00Z")).toISOString()).toBe("2026-01-09T23:00:00.000Z");
  });
  it("scheduleLabel", () => {
    expect(scheduleLabel(new Date(NOW.getTime() + 90 * 60000).toISOString(), NOW, { tomorrow: "Morgen" })).toBe("20:30");
    expect(scheduleLabel("2026-09-22T10:15:00Z", NOW, { tomorrow: "Morgen" })).toBe("Morgen 12:15");
    expect(scheduleLabel("2026-09-25T10:15:00Z", NOW, { tomorrow: "Morgen" })).toBe("25.09 · 12:15");
  });
  it("csv escapes and uses ; with BOM", () => {
    const s = toCsv([["Nr", "Kunde"], [2418, 'Anna "W"; Weber']]);
    expect(s.startsWith("﻿")).toBe(true);
    expect(s).toContain('2418;"Anna ""W""; Weber"');
  });
});
