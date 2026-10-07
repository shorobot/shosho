// Pure CRM logic (api-contracts §1.3, §6.4, §6.8). Side-effect free so the vitest suite can cover the
// arithmetic the operator trusts — the segment predicates, days-silent, the timeline merge — without a
// database. No React, no Supabase.
import type {
  Consent, ConsentChannel, Customer, CustomerAddressRow, CustomerEventRow, CustomerStatsRow, Json, Order, OrderRow,
} from "@/lib/types";
import { TZ } from "@/lib/time";

/* ------------------------------------------------------------------ tags */

/** The four tags the design defines (§1.3 `customers.tags`). Free-text tags are not offered. */
export const TAGS = ["VIP", "ALLERGIE", "KATERING", "PROBLEM"] as const;
export type Tag = (typeof TAGS)[number];

export function hasTag(c: { tags: string[] }, tag: Tag): boolean {
  return c.tags.includes(tag);
}

/** Add or remove one tag, order preserved and duplicates impossible. */
export function withTag(tags: string[], tag: Tag, on: boolean): string[] {
  const without = tags.filter((t) => t !== tag);
  return on ? [...without, tag] : without;
}

/* ------------------------------------------------------------------ stats & days silent */

/** An all-zero stats row, for a customer the view has no row for (or whose row has nulls). */
export const EMPTY_STATS: Required<Omit<CustomerStatsRow, "customer_id">> = {
  orders_count: 0,
  spent_cents: 0,
  avg_cents: 0,
  last_order_at: null as never,
  days_silent: null as never,
  cancelled_count: 0,
};

export type Stats = {
  orders_count: number;
  spent_cents: number;
  avg_cents: number;
  last_order_at: string | null;
  days_silent: number | null;
  cancelled_count: number;
};

/** The view's nullable columns flattened to the numbers the table renders. */
export function statsOf(row: CustomerStatsRow | undefined): Stats {
  return {
    orders_count: row?.orders_count ?? 0,
    spent_cents: row?.spent_cents ?? 0,
    avg_cents: row?.avg_cents ?? 0,
    last_order_at: row?.last_order_at ?? null,
    days_silent: row?.days_silent ?? null,
    cancelled_count: row?.cancelled_count ?? 0,
  };
}

/**
 * Days since the last completed order, or null when there has never been one.
 *
 * This mirrors how `customer_stats` computes it in SQL — `extract(day from now() - last_order_at)`,
 * which truncates an **elapsed interval**, not a difference of calendar dates. 47 hours ago is 1, not
 * 2, even when it crosses midnight. Getting that wrong would put customers in and out of the
 * "schlafend" segment one day early depending on the time of day, and would disagree with the number
 * the DB reports for the same row.
 */
export function daysSilentFrom(lastOrderAt: string | null | undefined, now: Date): number | null {
  if (!lastOrderAt) return null;
  const t = new Date(lastOrderAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000));
}

/**
 * `days_silent` for segmenting. The view's value is authoritative when present — it is the definition
 * S0 ruled on — and the local arithmetic is the fallback for a row the view did not return.
 */
export function effectiveDaysSilent(stats: Stats, now: Date): number | null {
  return stats.days_silent ?? daysSilentFrom(stats.last_order_at, now);
}

/* ------------------------------------------------------------------ segments */

export const SEGMENTS = ["regulars", "new_this_month", "sleeping", "companies"] as const;
export type Segment = (typeof SEGMENTS)[number];

/** Stammkunden: 3+ **completed** orders (the view counts delivered + picked_up only, §6.9 row 8). */
export const REGULAR_MIN_ORDERS = 3;
/** Schlafend: 60+ days since the last completed order. */
export const SLEEPING_MIN_DAYS = 60;

/** YYYY-MM of a timestamp in Europe/Berlin — the zone the DB reasons in (§6.10). */
export function monthKey(at: string | Date, tz = TZ): string {
  const d = typeof at === "string" ? new Date(at) : at;
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: tz }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}`;
}

/**
 * Whether a customer belongs to a segment.
 *
 * `new_this_month` is keyed on `customers.created_at`, not on a first-order timestamp: a profile is
 * created automatically by `place_order` when the phone number is new (§1.3), so the two coincide, and
 * `customer_stats` exposes no `first_order_at` to key on instead. Stated because it is an assumption,
 * not a fact the schema enforces — a profile created by hand would count as "new" with no order.
 *
 * `sleeping` requires a last order to exist: a customer who has never completed one is not sleeping,
 * they are new. Without that guard a null `days_silent` would read as 0 and never qualify anyway, but
 * the intent is worth being explicit about.
 */
export function inSegment(segment: Segment, customer: Customer, stats: Stats, now: Date): boolean {
  switch (segment) {
    case "regulars":
      return stats.orders_count >= REGULAR_MIN_ORDERS;
    case "new_this_month":
      return monthKey(customer.created_at) === monthKey(now);
    case "sleeping": {
      const d = effectiveDaysSilent(stats, now);
      return stats.last_order_at != null && d != null && d >= SLEEPING_MIN_DAYS;
    }
    case "companies":
      return customer.is_company;
  }
}

/** Live counts for the four segment tiles. */
export function segmentCounts(
  rows: { customer: Customer; stats: Stats }[],
  now: Date,
): Record<Segment, number> {
  const out = { regulars: 0, new_this_month: 0, sleeping: 0, companies: 0 };
  for (const r of rows) for (const s of SEGMENTS) if (inSegment(s, r.customer, r.stats, now)) out[s] += 1;
  return out;
}

/* ------------------------------------------------------------------ search */

/** Digits only, so "+49 151 22 44 880", "0151-224 4880" and "15122" all match the same number. */
function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

/** Germany — the only country the storefront delivers in, so the only national prefix to undo. */
const COUNTRY_CODE = "49";

/**
 * The forms a typed phone number might take, as digits.
 *
 * `customers.phone` is stored E.164 (`+4930…`, §1.3), but an operator taking a call types what the
 * customer reads out, which in Germany is the national form `030…`. A plain substring test misses
 * that: `493055120041` does not contain `03055120041`. So a leading national `0` is also tried as the
 * country code, and a `00` international prefix is tried stripped.
 */
function phoneQueryForms(queryDigits: string): string[] {
  const forms = [queryDigits];
  if (queryDigits.startsWith("00")) forms.push(queryDigits.slice(2));
  else if (queryDigits.startsWith("0")) forms.push(COUNTRY_CODE + queryDigits.slice(1));
  return forms;
}

function addressText(a: CustomerAddressRow): string {
  return [a.label, a.street, a.floor_apt, a.postal_code, a.city].filter(Boolean).join(" ");
}

/**
 * Search from the first character across name / phone / e-mail / address — the largest control on the
 * screen, because during a phone call it is the only one that matters (canvas note on BO · Kunden).
 *
 * A digit-bearing query is also matched against the digits of the phone number, so the way a caller
 * reads their number out ("one five one, two two...") finds them regardless of how it was stored.
 */
export function matchesCustomerSearch(customer: Customer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [customer.name, customer.email ?? "", customer.phone, ...customer.customer_addresses.map(addressText)]
    .join(" ")
    .toLowerCase();
  if (haystack.includes(q)) return true;
  const qd = digits(q);
  if (!qd) return false;
  const stored = digits(customer.phone);
  return phoneQueryForms(qd).some((form) => stored.includes(form));
}

/* ------------------------------------------------------------------ sorting */

export const SORT_KEYS = ["spent", "orders", "avg", "last_order", "days_silent", "name"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/**
 * Sort by any stat column. Rows with no value sort last in both directions — a customer who has never
 * ordered should not head the "longest silent" list, which is what a null-as-zero would do.
 */
export function sortCustomers(
  rows: { customer: Customer; stats: Stats }[],
  key: SortKey,
  dir: "asc" | "desc",
  now: Date,
): { customer: Customer; stats: Stats }[] {
  const sign = dir === "asc" ? 1 : -1;
  const value = (r: { customer: Customer; stats: Stats }): number | string | null => {
    switch (key) {
      case "spent":
        return r.stats.spent_cents;
      case "orders":
        return r.stats.orders_count;
      case "avg":
        return r.stats.avg_cents;
      case "last_order":
        return r.stats.last_order_at ? new Date(r.stats.last_order_at).getTime() : null;
      case "days_silent":
        return effectiveDaysSilent(r.stats, now);
      case "name":
        return r.customer.name.toLocaleLowerCase("de");
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (va == null && vb == null) return a.customer.name.localeCompare(b.customer.name, "de");
    if (va == null) return 1; // nulls last, whichever direction
    if (vb == null) return -1;
    if (typeof va === "string" || typeof vb === "string") return sign * String(va).localeCompare(String(vb), "de");
    if (va === vb) return a.customer.name.localeCompare(b.customer.name, "de");
    return sign * (va < vb ? -1 : 1);
  });
}

/* ------------------------------------------------------------------ consents */

export const CONSENT_CHANNELS: ConsentChannel[] = ["email", "push", "phone"];

export function consentColumn(channel: ConsentChannel): "consent_email" | "consent_push" | "consent_phone" {
  return channel === "email" ? "consent_email" : channel === "push" ? "consent_push" : "consent_phone";
}

export type ConsentView = { channel: ConsentChannel; granted: boolean; grantedAt: string | null; source: string | null };

/** The three consent rows, read straight off the customer (§6.8 — no extra call needed). */
export function consentsOf(customer: Customer): ConsentView[] {
  return CONSENT_CHANNELS.map((channel) => {
    const raw = customer[consentColumn(channel)] as Json | null;
    const c = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null) as Consent;
    return {
      channel,
      granted: c != null,
      grantedAt: typeof c?.granted_at === "string" ? c.granted_at : null,
      source: typeof c?.source === "string" ? c.source : null,
    };
  });
}

/* ------------------------------------------------------------------ anonymised customers */

/**
 * A customer the nightly 24-month job has anonymised (§6.8 `anonymise_silent_customers`). The row
 * still exists and still carries orders, so it must render as anonymised rather than as a broken
 * row — one of the BO · Zustände empty states.
 */
export function isAnonymised(customer: Pick<Customer, "anonymised_at">): boolean {
  return customer.anonymised_at != null;
}

/* ------------------------------------------------------------------ timeline */

export type TimelineEntry = {
  id: string;
  at: string;
  type: CustomerEventRow["type"];
  payload: Record<string, unknown>;
  actor_type: CustomerEventRow["actor_type"];
  actor_id: string | null;
  /** Set for an `order` entry: the live order row, so status and total are current. */
  order?: OrderRow;
  /** True when this entry was synthesised from an order with no `order` event of its own. */
  synthetic?: boolean;
};

export function asRecord(payload: Json | null | undefined): Record<string, unknown> {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

/**
 * The profile's "Verlauf": `customer_events` as the spine, with each `order` event **enriched** by the
 * live order row, plus an entry for any order that has no event of its own.
 *
 * The important thing this does *not* do is append the orders as a second stream. A trigger already
 * writes one `order` event per insert (`orders_customer_event`), so concatenating orders and events
 * would show every order twice. The merge is a union keyed on order id.
 *
 * Enrichment is needed because that event's payload is written `after insert`, when the status is
 * always `new`: the number and total are in the payload, but the status the design wants to show
 * ("Bestellung #2406 · 41,20 € · geliefert") only exists on the order row as it is today.
 *
 * Synthetic entries cover orders predating the trigger, and any order whose event was removed — the
 * screen should not quietly lose an order because an event row is missing.
 *
 * Newest first, matching §6.8's `.order('at', { ascending: false })`. Ties break on id so the order is
 * total and the render is stable rather than dependent on input order.
 */
export function mergeTimeline(events: CustomerEventRow[], orders: (OrderRow | Order)[]): TimelineEntry[] {
  const byId = new Map(orders.map((o) => [o.id, o as OrderRow]));
  const seen = new Set<string>();

  const entries: TimelineEntry[] = events.map((e) => {
    const payload = asRecord(e.payload);
    const orderId = typeof payload["order_id"] === "string" ? payload["order_id"] : null;
    if (e.type === "order" && orderId) seen.add(orderId);
    return {
      id: e.id,
      at: e.at,
      type: e.type,
      payload,
      actor_type: e.actor_type,
      actor_id: e.actor_id,
      ...(orderId && byId.has(orderId) ? { order: byId.get(orderId) } : {}),
    };
  });

  for (const o of orders) {
    if (seen.has(o.id)) continue;
    entries.push({
      id: `order:${o.id}`,
      at: o.created_at,
      type: "order",
      payload: { order_id: o.id, number: o.number, total_cents: o.total_cents, type: o.type },
      actor_type: "customer",
      actor_id: o.customer_id,
      order: o as OrderRow,
      synthetic: true,
    });
  }

  return entries.sort((a, b) => (a.at === b.at ? b.id.localeCompare(a.id) : b.at.localeCompare(a.at)));
}

/* ------------------------------------------------------------------ most-ordered items */

/** "Bestellt am häufigsten" — counted over the customer's order items, highest first. */
export function topItems(orders: Order[], limit = 5): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const o of orders) {
    for (const i of o.order_items ?? []) {
      counts.set(i.name, (counts.get(i.name) ?? 0) + i.qty);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => (b.count === a.count ? a.name.localeCompare(b.name, "de") : b.count - a.count))
    .slice(0, limit);
}

/* ------------------------------------------------------------------ GDPR export */

/**
 * Everything this customer's rows hold, as one object — "Daten exportieren" (Art. 15 / 20 DSGVO).
 * Assembled client-side from data already on screen: no new endpoint, and nothing the signed-in
 * operator could not already read.
 */
export function customerExport(
  customer: Customer,
  stats: Stats,
  events: CustomerEventRow[],
  orders: Order[],
): Record<string, unknown> {
  return {
    exported_at: new Date().toISOString(),
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      birthday: customer.birthday,
      is_company: customer.is_company,
      kitchen_note: customer.kitchen_note,
      tags: customer.tags,
      created_at: customer.created_at,
      updated_at: customer.updated_at,
      anonymised_at: customer.anonymised_at,
      consents: consentsOf(customer),
    },
    addresses: customer.customer_addresses,
    stats,
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      created_at: o.created_at,
      status: o.status,
      type: o.type,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      total_cents: o.total_cents,
      items: (o.order_items ?? []).map((i) => ({ name: i.name, qty: i.qty, unit_price_cents: i.unit_price_cents })),
    })),
    timeline: events.map((e) => ({ at: e.at, type: e.type, payload: e.payload, actor_type: e.actor_type })),
  };
}

/** The same export flattened for the CSV variant: one section per block, as `[label, …values]` rows. */
export function customerExportRows(customer: Customer, stats: Stats, events: CustomerEventRow[], orders: Order[]): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];
  rows.push(["KUNDE"]);
  rows.push(["id", customer.id]);
  rows.push(["name", customer.name]);
  rows.push(["phone", customer.phone]);
  rows.push(["email", customer.email]);
  rows.push(["birthday", customer.birthday]);
  rows.push(["is_company", String(customer.is_company)]);
  rows.push(["kitchen_note", customer.kitchen_note]);
  rows.push(["tags", customer.tags.join(" ")]);
  rows.push(["created_at", customer.created_at]);
  rows.push(["anonymised_at", customer.anonymised_at]);
  rows.push([]);
  rows.push(["EINWILLIGUNGEN"]);
  rows.push(["channel", "granted", "granted_at", "source"]);
  for (const c of consentsOf(customer)) rows.push([c.channel, String(c.granted), c.grantedAt, c.source]);
  rows.push([]);
  rows.push(["ADRESSEN"]);
  rows.push(["label", "street", "floor_apt", "postal_code", "city", "is_default"]);
  for (const a of customer.customer_addresses) rows.push([a.label, a.street, a.floor_apt, a.postal_code, a.city, String(a.is_default)]);
  rows.push([]);
  rows.push(["STATISTIK"]);
  rows.push(["orders_count", stats.orders_count]);
  rows.push(["spent_cents", stats.spent_cents]);
  rows.push(["avg_cents", stats.avg_cents]);
  rows.push(["last_order_at", stats.last_order_at]);
  rows.push(["days_silent", stats.days_silent]);
  rows.push(["cancelled_count", stats.cancelled_count]);
  rows.push([]);
  rows.push(["BESTELLUNGEN"]);
  rows.push(["number", "created_at", "status", "type", "payment_method", "payment_status", "total_cents"]);
  for (const o of orders) rows.push([o.number, o.created_at, o.status, o.type, o.payment_method, o.payment_status, o.total_cents]);
  rows.push([]);
  rows.push(["VERLAUF"]);
  rows.push(["at", "type", "payload"]);
  for (const e of events) rows.push([e.at, e.type, JSON.stringify(e.payload)]);
  return rows;
}

/* ------------------------------------------------------------------ erasure request */

/**
 * On-request erasure for a single customer has no server-side implementation: only the nightly
 * 24-month `anonymise_silent_customers` job exists (§6.8 GDPR note), and S2's proposal
 * `S2-single-customer-erasure.md` covers adding one.
 *
 * Rather than render a button that lies or one that is merely dead, "Daten löschen" files an
 * auditable request as a `note` on the customer's own timeline, which an operator actions by hand.
 * That keeps the Art. 17 clock visible — the request, who made it and when — where a disabled control
 * would record nothing at all.
 *
 * `kind` is a marker for the future RPC to find these rows; `payload` is free jsonb, and
 * `add_customer_event` only requires `text` for a note.
 */
export const ERASURE_REQUEST_KIND = "erasure_request" as const;

export function erasureRequestPayload(customer: Customer, staffName: string, now: Date): Record<string, Json> {
  return {
    kind: ERASURE_REQUEST_KIND,
    text: `DSGVO Art. 17 — Löschung der Daten beantragt für ${customer.name} (${customer.phone}). Angefordert von ${staffName} am ${now.toISOString()}. Muss manuell ausgeführt werden: es gibt noch keine serverseitige Einzellöschung.`,
    requested_at: now.toISOString(),
    requested_by: staffName,
  };
}

/** True for a timeline note that is an erasure request, so the profile can show it is pending. */
export function isErasureRequest(entry: { type: string; payload: Record<string, unknown> }): boolean {
  return entry.type === "note" && entry.payload["kind"] === ERASURE_REQUEST_KIND;
}
