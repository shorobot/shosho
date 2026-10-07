// CRM logic (api-contracts §1.3 / §6.4 / §6.8). The segment predicates and days-silent arithmetic are
// what decide which customers an operator calls back, and the timeline merge is what stops an order
// appearing twice — all three are covered here rather than eyeballed on screen.
import { describe, expect, it } from "vitest";
import {
  consentsOf, customerExport, customerExportRows, daysSilentFrom, effectiveDaysSilent, erasureRequestPayload,
  inSegment, isAnonymised, isErasureRequest, matchesCustomerSearch, mergeTimeline, monthKey, segmentCounts,
  sortCustomers, statsOf, topItems, withTag, type Stats,
} from "@/lib/crm";
import type { Customer, CustomerEventRow, Order, OrderRow } from "@/lib/types";

const NOW = new Date("2026-10-06T12:00:00.000Z");

function customer(p: Partial<Customer> = {}): Customer {
  return {
    id: "c-1",
    name: "Anna Weber",
    phone: "+4915122448800",
    email: "anna.weber@mail.de",
    birthday: null,
    is_company: false,
    kitchen_note: null,
    tags: [],
    consent_email: null,
    consent_push: null,
    consent_phone: null,
    anonymised_at: null,
    created_at: "2024-03-12T10:00:00.000Z",
    updated_at: "2026-10-01T10:00:00.000Z",
    customer_addresses: [],
    ...p,
  };
}

function stats(p: Partial<Stats> = {}): Stats {
  return { orders_count: 0, spent_cents: 0, avg_cents: 0, last_order_at: null, days_silent: null, cancelled_count: 0, ...p };
}

function event(p: Partial<CustomerEventRow> = {}): CustomerEventRow {
  return { id: "e-1", customer_id: "c-1", at: "2026-10-01T10:00:00.000Z", type: "note", payload: {}, actor_type: "staff", actor_id: "s-1", ...p };
}

function order(p: Partial<OrderRow> = {}): OrderRow {
  return {
    id: "o-1", number: 2406, customer_id: "c-1", created_at: "2026-09-14T17:00:00.000Z", status: "delivered",
    type: "delivery", total_cents: 4120, payment_method: "card", payment_status: "pending",
    ...p,
  } as unknown as OrderRow;
}

/* ------------------------------------------------------------------ days silent */

describe("daysSilentFrom — matches the view's SQL, not calendar dates", () => {
  it("truncates an elapsed interval", () => {
    // customer_stats computes extract(day from now() - last_order_at): whole elapsed days.
    expect(daysSilentFrom("2026-10-05T12:00:00.000Z", NOW)).toBe(1);
    expect(daysSilentFrom("2026-10-04T13:00:00.000Z", NOW)).toBe(1); // 47 h -> 1, not 2
    expect(daysSilentFrom("2026-10-04T11:00:00.000Z", NOW)).toBe(2); // 49 h -> 2
    expect(daysSilentFrom("2026-10-06T11:00:00.000Z", NOW)).toBe(0);
  });

  it("does NOT count midnight crossings", () => {
    // Yesterday 23:00 -> today 12:00 is 13 hours. A calendar-date difference would say 1 and would
    // disagree with the number the DB reports for the same row.
    expect(daysSilentFrom("2026-10-05T23:00:00.000Z", NOW)).toBe(0);
  });

  it("is null when there has never been a completed order", () => {
    expect(daysSilentFrom(null, NOW)).toBeNull();
    expect(daysSilentFrom(undefined, NOW)).toBeNull();
    expect(daysSilentFrom("not-a-date", NOW)).toBeNull();
  });

  it("never goes negative on a clock skew", () => {
    expect(daysSilentFrom("2026-10-08T12:00:00.000Z", NOW)).toBe(0);
  });

  it("prefers the view's value and falls back to local arithmetic", () => {
    expect(effectiveDaysSilent(stats({ days_silent: 77, last_order_at: "2026-10-05T12:00:00.000Z" }), NOW)).toBe(77);
    expect(effectiveDaysSilent(stats({ days_silent: null, last_order_at: "2026-09-06T12:00:00.000Z" }), NOW)).toBe(30);
    expect(effectiveDaysSilent(stats(), NOW)).toBeNull();
  });
});

/* ------------------------------------------------------------------ segments */

describe("segment predicates", () => {
  it("Stammkunden is 3+ completed orders", () => {
    expect(inSegment("regulars", customer(), stats({ orders_count: 2 }), NOW)).toBe(false);
    expect(inSegment("regulars", customer(), stats({ orders_count: 3 }), NOW)).toBe(true);
    expect(inSegment("regulars", customer(), stats({ orders_count: 27 }), NOW)).toBe(true);
  });

  it("Stammkunden counts completed orders only — a cancelled run does not qualify", () => {
    // customer_stats already excludes cancelled from orders_count (§6.9 row 8); this asserts the
    // segment reads that column and not some count of its own.
    expect(inSegment("regulars", customer(), stats({ orders_count: 0, cancelled_count: 9 }), NOW)).toBe(false);
  });

  it("Neu diesen Monat is the profile's own creation month, in Berlin", () => {
    expect(inSegment("new_this_month", customer({ created_at: "2026-10-02T08:00:00.000Z" }), stats(), NOW)).toBe(true);
    expect(inSegment("new_this_month", customer({ created_at: "2026-09-30T08:00:00.000Z" }), stats(), NOW)).toBe(false);
    // 30 Sep 23:30 UTC is 1 Oct 01:30 in Berlin — the month boundary is the Berlin one.
    expect(inSegment("new_this_month", customer({ created_at: "2026-09-30T23:30:00.000Z" }), stats(), NOW)).toBe(true);
  });

  it("Schlafend is 60+ days silent", () => {
    const sleeping = stats({ orders_count: 4, last_order_at: "2026-07-01T12:00:00.000Z", days_silent: 97 });
    expect(inSegment("sleeping", customer(), sleeping, NOW)).toBe(true);
    expect(inSegment("sleeping", customer(), stats({ last_order_at: "2026-10-01T12:00:00.000Z", days_silent: 5 }), NOW)).toBe(false);
    expect(inSegment("sleeping", customer(), stats({ last_order_at: "2026-08-07T12:00:00.000Z", days_silent: 60 }), NOW)).toBe(true);
    expect(inSegment("sleeping", customer(), stats({ last_order_at: "2026-08-08T12:00:00.000Z", days_silent: 59 }), NOW)).toBe(false);
  });

  it("a customer who never ordered is NOT sleeping", () => {
    // Null days_silent must not read as 0 or as "forever silent" — they are new, not churning.
    expect(inSegment("sleeping", customer(), stats({ last_order_at: null, days_silent: null }), NOW)).toBe(false);
  });

  it("Firmen is the is_company flag", () => {
    expect(inSegment("companies", customer({ is_company: true }), stats(), NOW)).toBe(true);
    expect(inSegment("companies", customer({ is_company: false }), stats(), NOW)).toBe(false);
  });

  it("counts every tile in one pass, and a customer can be in several", () => {
    const rows = [
      { customer: customer({ id: "a", is_company: true }), stats: stats({ orders_count: 5, last_order_at: "2026-01-01T12:00:00.000Z", days_silent: 278 }) },
      { customer: customer({ id: "b", created_at: "2026-10-03T12:00:00.000Z" }), stats: stats({ orders_count: 1, last_order_at: "2026-10-03T12:00:00.000Z", days_silent: 3 }) },
      { customer: customer({ id: "c" }), stats: stats({ orders_count: 3, last_order_at: "2026-10-05T12:00:00.000Z", days_silent: 1 }) },
    ];
    expect(segmentCounts(rows, NOW)).toEqual({ regulars: 2, new_this_month: 1, sleeping: 1, companies: 1 });
  });

  it("monthKey is Berlin-based", () => {
    expect(monthKey("2026-10-06T12:00:00.000Z")).toBe("2026-10");
    expect(monthKey("2026-12-31T23:30:00.000Z")).toBe("2027-01"); // 00:30 Berlin, next year
  });
});

/* ------------------------------------------------------------------ search */

describe("matchesCustomerSearch — from the first character", () => {
  const c = customer({
    name: "Büro Kleist",
    email: "office@kleist.de",
    phone: "+493055120041",
    customer_addresses: [
      { id: "a1", customer_id: "c-1", label: "Büro", street: "Brunnenstraße 12", floor_apt: "3. OG", postal_code: "10119", city: "Berlin", zone_id: null, is_default: true, created_at: "", updated_at: "" },
    ],
  });

  it("matches on a single character", () => {
    expect(matchesCustomerSearch(c, "B")).toBe(true);
    expect(matchesCustomerSearch(c, "k")).toBe(true);
  });

  it("matches name, e-mail, address, postcode and city", () => {
    for (const q of ["kleist", "OFFICE@", "Brunnenstr", "10119", "berlin", "3. OG", "Büro"]) {
      expect(matchesCustomerSearch(c, q), q).toBe(true);
    }
  });

  it("matches a phone number however it is punctuated", () => {
    for (const q of ["+49 30 55 12 0041", "030-5512 0041", "5512", "+493055120041"]) {
      expect(matchesCustomerSearch(c, q), q).toBe(true);
    }
  });

  it("does not match something absent", () => {
    expect(matchesCustomerSearch(c, "weber")).toBe(false);
    expect(matchesCustomerSearch(c, "99999")).toBe(false);
  });

  it("an empty query matches everything", () => {
    expect(matchesCustomerSearch(c, "")).toBe(true);
    expect(matchesCustomerSearch(c, "   ")).toBe(true);
  });
});

/* ------------------------------------------------------------------ sorting */

describe("sortCustomers", () => {
  const rows = [
    { customer: customer({ id: "a", name: "Anna" }), stats: stats({ spent_cents: 48620, orders_count: 14, last_order_at: "2026-10-04T12:00:00.000Z", days_silent: 2 }) },
    { customer: customer({ id: "b", name: "Büro" }), stats: stats({ spent_cents: 214800, orders_count: 27, last_order_at: "2026-10-05T12:00:00.000Z", days_silent: 1 }) },
    { customer: customer({ id: "n", name: "Neukunde" }), stats: stats() },
  ];

  it("sorts spend descending by default usage", () => {
    expect(sortCustomers(rows, "spent", "desc", NOW).map((r) => r.customer.id)).toEqual(["b", "a", "n"]);
  });

  it("sorts ascending too", () => {
    expect(sortCustomers(rows, "orders", "asc", NOW).map((r) => r.customer.id)).toEqual(["n", "a", "b"]);
  });

  it("keeps rows with no value last in BOTH directions", () => {
    // A customer who never ordered must not head the "longest silent" list.
    expect(sortCustomers(rows, "days_silent", "desc", NOW).map((r) => r.customer.id).at(-1)).toBe("n");
    expect(sortCustomers(rows, "days_silent", "asc", NOW).map((r) => r.customer.id).at(-1)).toBe("n");
    expect(sortCustomers(rows, "last_order", "desc", NOW).map((r) => r.customer.id).at(-1)).toBe("n");
    expect(sortCustomers(rows, "last_order", "asc", NOW).map((r) => r.customer.id).at(-1)).toBe("n");
  });

  it("sorts by name with German collation", () => {
    expect(sortCustomers(rows, "name", "asc", NOW).map((r) => r.customer.name)).toEqual(["Anna", "Büro", "Neukunde"]);
  });

  it("does not mutate its input", () => {
    const before = rows.map((r) => r.customer.id);
    sortCustomers(rows, "spent", "desc", NOW);
    expect(rows.map((r) => r.customer.id)).toEqual(before);
  });
});

/* ------------------------------------------------------------------ timeline merge */

describe("mergeTimeline", () => {
  it("newest first", () => {
    const entries = mergeTimeline(
      [event({ id: "e1", at: "2026-07-04T10:00:00.000Z" }), event({ id: "e2", at: "2026-08-28T10:00:00.000Z" }), event({ id: "e3", at: "2026-09-02T10:00:00.000Z" })],
      [],
    );
    expect(entries.map((e) => e.id)).toEqual(["e3", "e2", "e1"]);
  });

  it("does NOT show an order twice — the trigger already wrote an order event", () => {
    // orders_customer_event inserts one `order` event per order. Concatenating the orders as a second
    // stream would duplicate every one of them; the merge is a union keyed on order id.
    const o = order({ id: "o-1", number: 2406 });
    const entries = mergeTimeline([event({ id: "e1", type: "order", at: o.created_at, payload: { order_id: "o-1", number: 2406 } })], [o]);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("e1");
  });

  it("enriches an order event with the live order row, so status is current", () => {
    // The event payload is written `after insert`, when the status is always `new`. The design wants
    // to show "geliefert", which only the order row knows.
    const o = order({ id: "o-1", status: "delivered", total_cents: 4120 });
    const entries = mergeTimeline([event({ id: "e1", type: "order", payload: { order_id: "o-1", number: 2406 } })], [o]);
    expect(entries[0]!.order?.status).toBe("delivered");
    expect(entries[0]!.order?.total_cents).toBe(4120);
  });

  it("synthesises an entry for an order with no event of its own", () => {
    // Orders predating the trigger, or whose event row was removed, must not vanish from the profile.
    const o = order({ id: "o-9", number: 2298, created_at: "2026-08-19T17:00:00.000Z" });
    const entries = mergeTimeline([event({ id: "e1", at: "2026-09-02T10:00:00.000Z" })], [o]);
    expect(entries).toHaveLength(2);
    const synth = entries.find((e) => e.synthetic);
    expect(synth?.type).toBe("order");
    expect(synth?.order?.number).toBe(2298);
    expect(synth?.payload["order_id"]).toBe("o-9");
  });

  it("interleaves synthesised orders into the right chronological place", () => {
    const entries = mergeTimeline(
      [event({ id: "e-late", at: "2026-10-01T10:00:00.000Z" }), event({ id: "e-early", at: "2026-08-01T10:00:00.000Z" })],
      [order({ id: "o-mid", created_at: "2026-09-01T10:00:00.000Z" })],
    );
    expect(entries.map((e) => e.id)).toEqual(["e-late", "order:o-mid", "e-early"]);
  });

  it("is a total order on identical timestamps, so the render is stable", () => {
    const at = "2026-09-02T10:00:00.000Z";
    const a = mergeTimeline([event({ id: "e1", at }), event({ id: "e2", at })], []).map((e) => e.id);
    const b = mergeTimeline([event({ id: "e2", at }), event({ id: "e1", at })], []).map((e) => e.id);
    expect(a).toEqual(b);
  });

  it("keeps a non-order event's payload and actor", () => {
    const entries = mergeTimeline([event({ id: "e1", type: "compensation", payload: { kind: "voucher", amount_cents: 800 }, actor_type: "staff", actor_id: "s-7" })], []);
    expect(entries[0]!.payload).toEqual({ kind: "voucher", amount_cents: 800 });
    expect(entries[0]!.actor_id).toBe("s-7");
    expect(entries[0]!.order).toBeUndefined();
  });

  it("tolerates an order event whose order is not loaded", () => {
    const entries = mergeTimeline([event({ id: "e1", type: "order", payload: { order_id: "gone", number: 1 } })], []);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.order).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ consents, tags, misc */

describe("consentsOf", () => {
  it("reads date and source per channel", () => {
    const c = customer({
      consent_email: { granted_at: "2024-03-12T10:00:00.000Z", source: "checkout" },
      consent_push: { granted_at: "2025-07-04T10:00:00.000Z", source: "app" },
      consent_phone: null,
    });
    expect(consentsOf(c)).toEqual([
      { channel: "email", granted: true, grantedAt: "2024-03-12T10:00:00.000Z", source: "checkout" },
      { channel: "push", granted: true, grantedAt: "2025-07-04T10:00:00.000Z", source: "app" },
      { channel: "phone", granted: false, grantedAt: null, source: null },
    ]);
  });

  it("treats a malformed consent value as not granted rather than throwing", () => {
    const c = customer({ consent_email: "yes" as never, consent_push: [] as never });
    const v = consentsOf(c);
    expect(v[0]!.granted).toBe(false);
    expect(v[1]!.granted).toBe(false);
  });
});

describe("tags", () => {
  it("adds and removes without duplicating", () => {
    expect(withTag([], "VIP", true)).toEqual(["VIP"]);
    expect(withTag(["VIP"], "VIP", true)).toEqual(["VIP"]);
    expect(withTag(["VIP", "ALLERGIE"], "VIP", false)).toEqual(["ALLERGIE"]);
    expect(withTag(["VIP"], "PROBLEM", true)).toEqual(["VIP", "PROBLEM"]);
  });
});

describe("statsOf", () => {
  it("flattens the view's nullable columns", () => {
    expect(statsOf(undefined)).toEqual({ orders_count: 0, spent_cents: 0, avg_cents: 0, last_order_at: null, days_silent: null, cancelled_count: 0 });
    expect(statsOf({ customer_id: "c-1", orders_count: null, spent_cents: null, avg_cents: null, last_order_at: null, days_silent: null, cancelled_count: null }).orders_count).toBe(0);
  });
});

describe("isAnonymised", () => {
  it("is the anonymised_at stamp", () => {
    expect(isAnonymised(customer())).toBe(false);
    expect(isAnonymised(customer({ anonymised_at: "2026-10-01T00:00:00.000Z" }))).toBe(true);
  });
});

describe("topItems", () => {
  it("counts quantities, not lines, highest first", () => {
    const orders = [
      { ...order({ id: "o1" }), order_items: [{ name: "Philadelphia Deluxe", qty: 5 }, { name: "Miso Suppe", qty: 2 }], order_events: [] },
      { ...order({ id: "o2" }), order_items: [{ name: "Philadelphia Deluxe", qty: 4 }, { name: "Miso Suppe", qty: 5 }, { name: "Grüner Tee", qty: 5 }], order_events: [] },
    ] as unknown as Order[];
    expect(topItems(orders, 3)).toEqual([
      { name: "Philadelphia Deluxe", count: 9 },
      { name: "Miso Suppe", count: 7 },
      { name: "Grüner Tee", count: 5 },
    ]);
  });

  it("breaks ties by name so the list does not reshuffle between renders", () => {
    const orders = [{ ...order(), order_items: [{ name: "Zuppa", qty: 1 }, { name: "Ahi", qty: 1 }], order_events: [] }] as unknown as Order[];
    expect(topItems(orders).map((i) => i.name)).toEqual(["Ahi", "Zuppa"]);
  });

  it("is empty for a customer with no orders", () => {
    expect(topItems([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ GDPR */

describe("customerExport", () => {
  const c = customer({ consent_email: { granted_at: "2024-03-12T10:00:00.000Z", source: "checkout" } });
  const orders = [{ ...order(), order_items: [{ name: "Philadelphia Deluxe", qty: 2, unit_price_cents: 1490 }], order_events: [] }] as unknown as Order[];

  it("carries every block the customer's rows hold", () => {
    const out = customerExport(c, stats({ orders_count: 1 }), [event({ type: "complaint", payload: { text: "late" } })], orders);
    expect(Object.keys(out)).toEqual(["exported_at", "customer", "addresses", "stats", "orders", "timeline"]);
    expect((out.customer as Record<string, unknown>).phone).toBe("+4915122448800");
    expect((out.customer as Record<string, unknown>).consents).toHaveLength(3);
    expect(out.orders).toHaveLength(1);
    expect(out.timeline).toHaveLength(1);
  });

  it("produces CSV rows with a section per block", () => {
    const rows = customerExportRows(c, stats(), [event()], orders);
    const flat = rows.map((r) => String(r[0]));
    for (const section of ["KUNDE", "EINWILLIGUNGEN", "ADRESSEN", "STATISTIK", "BESTELLUNGEN", "VERLAUF"]) {
      expect(flat, section).toContain(section);
    }
  });
});

describe("erasure request", () => {
  const c = customer();

  it("files a note that names the customer, the operator and the date", () => {
    const p = erasureRequestPayload(c, "Marek K.", NOW);
    expect(p.kind).toBe("erasure_request");
    expect(String(p.text)).toContain("Anna Weber");
    expect(String(p.text)).toContain("Marek K.");
    expect(p.requested_at).toBe(NOW.toISOString());
  });

  it("satisfies add_customer_event's requirement that a note carry text", () => {
    // The RPC raises invalid_input when payload.text is blank for a note (§6.8).
    expect(String(erasureRequestPayload(c, "Marek K.", NOW).text).trim().length).toBeGreaterThan(0);
  });

  it("is recognisable again on the timeline, so the profile can show it is pending", () => {
    const p = erasureRequestPayload(c, "Marek K.", NOW);
    expect(isErasureRequest({ type: "note", payload: p })).toBe(true);
    expect(isErasureRequest({ type: "note", payload: { text: "prefers delivery after 19:00" } })).toBe(false);
    expect(isErasureRequest({ type: "complaint", payload: p })).toBe(false);
  });
});
