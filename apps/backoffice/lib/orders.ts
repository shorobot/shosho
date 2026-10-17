// Pure board logic: grouping into the design's four columns, search/filter chips, timers and the
// transition → button mapping. No I/O here — everything is unit-tested in tests/orders.test.ts.
import type { Key } from "@/lib/i18n";
import type { Address, Order, OrderStatus, OrderType, PaymentStatus, StaffRole } from "@/lib/types";
import { dayKey, minutesBetween } from "@/lib/time";

/**
 * `orders.cancel_reason` stable codes (S6-01 finding 5). `CancelDialog.tsx` used to send `t(reason)`
 * — the label **already translated in whichever language the operator's UI is in** — so a DE
 * cancellation wrote a German sentence into a column the EN-toggled detail view, the CSV export and
 * every future report render verbatim, forever, in whatever language it happened to be cancelled in.
 * The code travels; the label is looked up at render time with the viewer's own language.
 */
export const CANCEL_REASON_CODES = ["customer", "unreachable", "soldout", "out_of_zone", "payment", "other"] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export const CANCEL_REASON_KEY: Record<CancelReasonCode, Key> = {
  customer: "cancel.reason.customer",
  unreachable: "cancel.reason.unreachable",
  soldout: "cancel.reason.soldout",
  out_of_zone: "cancel.reason.outOfZone",
  payment: "cancel.reason.payment",
  other: "cancel.reason.other",
};

/**
 * `orders.cancel_reason` → display text. Rows written before this fix hold an already-translated
 * sentence rather than a code (no migration — nothing in the column shape changed, and backfilling
 * a free-text sentence back into one of six codes would be a guess); such a value doesn't match any
 * key and is shown as-is, which is exactly what it already was. A row written after the fix matches
 * a key and renders in the viewer's own language regardless of which language cancelled it.
 */
export function cancelReasonLabel(code: string | null | undefined, t: (k: Key) => string): string | null {
  if (!code) return null;
  const key = (CANCEL_REASON_KEY as Record<string, Key>)[code];
  return key ? t(key) : code;
}

export const ACTIVE: OrderStatus[] = ["new", "accepted", "preparing", "ready", "out_for_delivery"];
export const DONE: OrderStatus[] = ["delivered", "picked_up", "cancelled", "refunded"];
export const KITCHEN_STATUSES: OrderStatus[] = ["accepted", "preparing", "ready"];

/** Pre-orders move from the "Vorbestellungen" column into "In Arbeit" this many minutes before the slot. */
export const PREORDER_LEAD_MIN = 45;

export type Filter = "all" | "delivery" | "pickup" | "paid" | "open" | "scheduled";
export const FILTERS: Filter[] = ["all", "delivery", "pickup", "paid", "open", "scheduled"];

export type Groups = {
  inProgress: Order[];
  onTheWay: Order[];
  doneToday: Order[];
  preorders: Order[];
};

export function isPaid(s: PaymentStatus): boolean {
  return s === "paid" || s === "authorized";
}

export function isPreorderPending(o: Pick<Order, "scheduled_for" | "status">, now: Date, leadMin = PREORDER_LEAD_MIN): boolean {
  if (!o.scheduled_for) return false;
  if (o.status !== "new" && o.status !== "accepted") return false;
  return new Date(o.scheduled_for).getTime() - now.getTime() > leadMin * 60000;
}

function completedAt(o: Order): string | null {
  return o.completed_at ?? o.cancelled_at ?? o.updated_at ?? null;
}

const STATUS_RANK: Record<OrderStatus, number> = {
  new: 0, accepted: 1, preparing: 2, ready: 3, out_for_delivery: 4, delivered: 5, picked_up: 5, cancelled: 6, refunded: 7,
};

export function groupOrders(orders: Order[], now: Date, leadMin = PREORDER_LEAD_MIN): Groups {
  const today = dayKey(now);
  const g: Groups = { inProgress: [], onTheWay: [], doneToday: [], preorders: [] };
  for (const o of orders) {
    if (isPreorderPending(o, now, leadMin)) g.preorders.push(o);
    else if (o.status === "out_for_delivery") g.onTheWay.push(o);
    else if (ACTIVE.includes(o.status)) g.inProgress.push(o);
    else if (DONE.includes(o.status)) {
      const at = completedAt(o);
      if (at && dayKey(new Date(at)) === today) g.doneToday.push(o);
    }
  }
  // In Arbeit: new first (oldest new on top), then by status rank, then by age.
  g.inProgress.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.created_at.localeCompare(b.created_at));
  g.onTheWay.sort((a, b) => (a.out_at ?? a.created_at).localeCompare(b.out_at ?? b.created_at));
  g.doneToday.sort((a, b) => (completedAt(b) ?? "").localeCompare(completedAt(a) ?? ""));
  g.preorders.sort((a, b) => (a.scheduled_for ?? "").localeCompare(b.scheduled_for ?? ""));
  return g;
}

export function addressOf(o: Pick<Order, "address">): Address {
  const a = o.address;
  if (a && typeof a === "object" && !Array.isArray(a)) return a as Address;
  return {};
}

export function addressLine(o: Pick<Order, "address">): string {
  const a = addressOf(o);
  const parts = [a.street, a.floor_apt].filter(Boolean);
  return parts.join(", ");
}

export function matchesSearch(o: Order, q: string): boolean {
  const s = q.trim().toLowerCase().replace(/^#/, "");
  if (!s) return true;
  const a = addressOf(o);
  const hay = [
    String(o.number),
    o.contact_name,
    o.contact_phone,
    o.contact_phone.replace(/\s+/g, ""),
    a.street,
    a.postal_code,
    a.city,
    a.floor_apt,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return s.split(/\s+/).every((tok) => hay.includes(tok.replace(/\s+/g, "")));
}

export function matchesFilter(o: Order, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "delivery":
      return o.type === "delivery";
    case "pickup":
      return o.type === "pickup";
    case "paid":
      return isPaid(o.payment_status);
    case "open":
      return o.payment_status === "pending" || o.payment_status === "failed";
    case "scheduled":
      return o.scheduled_for != null;
  }
}

export function applyFilters(orders: Order[], q: string, f: Filter): Order[] {
  return orders.filter((o) => matchesFilter(o, f) && matchesSearch(o, q));
}

export type Kpis = {
  orders: number;
  revenueCents: number;
  avgTicketCents: number | null;
  avgDeliveryMin: number | null;
  deliveredCount: number;
  cancelled: number;
  cancelledPct: number | null;
};

/** Today's KPIs from the loaded orders (client-side, api-contracts §6.1). */
export function kpis(orders: Order[], now: Date): Kpis {
  const today = dayKey(now);
  const todays = orders.filter((o) => dayKey(new Date(o.created_at)) === today);
  const good = todays.filter((o) => o.status !== "cancelled" && o.status !== "refunded");
  const revenueCents = good.reduce((s, o) => s + o.total_cents, 0);
  const delivered = todays.filter((o) => o.status === "delivered" && o.completed_at);
  const mins = delivered.map((o) => minutesBetween(o.created_at, o.completed_at) ?? 0);
  const cancelled = todays.filter((o) => o.status === "cancelled").length;
  return {
    orders: todays.length,
    revenueCents,
    avgTicketCents: good.length ? Math.round(revenueCents / good.length) : null,
    avgDeliveryMin: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null,
    deliveredCount: delivered.length,
    cancelled,
    cancelledPct: todays.length ? Math.round((cancelled / todays.length) * 1000) / 10 : null,
  };
}

/** Promised ETA, same formula as get_order_by_token: (preparing_at ?? accepted_at ?? created_at) + promised. */
export function eta(o: Order): Date | null {
  if (DONE.includes(o.status)) return null;
  if (o.scheduled_for) return new Date(o.scheduled_for);
  const base = o.preparing_at ?? o.accepted_at ?? o.created_at;
  return new Date(new Date(base).getTime() + (o.promised_minutes ?? 0) * 60000);
}

export type Urgency = "normal" | "warn" | "critical";

export type Timer =
  | { kind: "waiting"; since: string; urgency: Urgency }
  | { kind: "start"; at: string; urgency: Urgency }
  | { kind: "cooking"; elapsedMin: number; promisedMin: number; overdue: boolean; progress: number; urgency: Urgency }
  | { kind: "standing"; min: number; urgency: Urgency }
  | { kind: "eta"; at: Date | null; urgency: Urgency }
  | { kind: "done"; at: string | null; urgency: Urgency };

export const NEW_WAIT_WARN_MIN = 1;
export const NEW_WAIT_CRITICAL_MIN = 3;
export const READY_STANDING_CRITICAL_MIN = 10;

/** What the card's top-right label shows, and how urgent the card is (border colour). */
export function timerFor(o: Order, now: Date): Timer {
  switch (o.status) {
    case "new": {
      const m = minutesBetween(o.created_at, now) ?? 0;
      const urgency: Urgency = m >= NEW_WAIT_CRITICAL_MIN ? "critical" : m >= NEW_WAIT_WARN_MIN ? "warn" : "normal";
      return { kind: "waiting", since: o.created_at, urgency };
    }
    case "accepted":
      return { kind: "start", at: o.scheduled_for ? new Date(new Date(o.scheduled_for).getTime() - (o.promised_minutes ?? 0) * 60000).toISOString() : (o.accepted_at ?? o.created_at), urgency: "normal" };
    case "preparing": {
      const elapsedMin = minutesBetween(o.preparing_at ?? o.accepted_at ?? o.created_at, now) ?? 0;
      const promisedMin = o.promised_minutes ?? 0;
      const overdue = promisedMin > 0 && elapsedMin > promisedMin;
      const progress = promisedMin > 0 ? Math.min(1, elapsedMin / promisedMin) : 0;
      const urgency: Urgency = overdue ? "critical" : progress >= 0.65 ? "warn" : "normal";
      return { kind: "cooking", elapsedMin, promisedMin, overdue, progress, urgency };
    }
    case "ready": {
      const min = minutesBetween(o.ready_at ?? o.created_at, now) ?? 0;
      return { kind: "standing", min, urgency: min >= READY_STANDING_CRITICAL_MIN ? "critical" : "normal" };
    }
    case "out_for_delivery":
      return { kind: "eta", at: eta(o), urgency: "normal" };
    default:
      return { kind: "done", at: completedAt(o), urgency: "normal" };
  }
}

// ---------------------------------------------------------------- status machine (mirror of order_transition_allowed)

export function transitionAllowed(from: OrderStatus, to: OrderStatus, type: OrderType, pay: PaymentStatus): boolean {
  switch (from) {
    case "new":
      return to === "accepted" || to === "cancelled";
    case "accepted":
      return to === "preparing" || to === "cancelled";
    case "preparing":
      return to === "ready" || to === "cancelled";
    case "ready":
      return (to === "out_for_delivery" && type === "delivery") || (to === "picked_up" && type === "pickup") || to === "cancelled";
    case "out_for_delivery":
      return to === "delivered" || to === "cancelled";
    case "delivered":
    case "picked_up":
      return to === "refunded" && pay === "paid";
    default:
      return false;
  }
}

export type ActionId = "accept" | "reject" | "start" | "ready" | "hand_to_driver" | "handed_out" | "delivered" | "cancel" | "refund";

export type Action = {
  id: ActionId;
  to: OrderStatus;
  /** primary = the orange/ink pill; secondary = the soft pill */
  primary: boolean;
  /** needs a dialog before the RPC (driver pick / cancel reason / refund confirm / cash in hand?) */
  dialog?: "driver" | "cancel" | "refund" | "cash";
};

/**
 * Completing a **cash** order has to ask whether the money is actually in hand, because the server
 * reads `coalesce((payload->>'cash_received')::boolean, false)` — "absent" settles as **no**, leaving
 * a genuinely-collected order `pending` forever (S6-01 finding 2; api-contracts §6.8 promises "the
 * driver *or the operator on their behalf* confirms"). Pickup has no driver role at all, so the
 * board's button is the only path to complete one.
 *
 * It must be a question, not a default, in **either** direction: defaulting to `false` loses real
 * revenue silently, and defaulting to `true` asserts revenue that may not exist — the worse of the
 * two, because it reconciles against nothing. Non-cash orders are not asked: the server's cash
 * branch is `elsif o.payment_method = 'cash'`, so the flag is never read for them and a dialog there
 * would be a click that changes nothing.
 */
export function needsCashConfirm(o: Pick<Order, "payment_method" | "payment_status">, to: OrderStatus): boolean {
  if (to !== "delivered" && to !== "picked_up") return false;
  if (o.payment_method !== "cash") return false;
  // Already settled (counter cash recorded at entry, §6.8 `payment_recorded_by_staff`) — nothing to ask.
  return !isPaid(o.payment_status) && o.payment_status !== "refunded";
}

/** Which buttons a role sees on a card in this status (api-contracts §6.1 + role gates in set_order_status). */
export function actionsFor(o: Pick<Order, "status" | "type" | "payment_status" | "payment_method" | "driver_id">, role: StaffRole, uid?: string): Action[] {
  const all: Action[] = [];
  const s = o.status;
  if (s === "new") {
    all.push({ id: "accept", to: "accepted", primary: true }, { id: "reject", to: "cancelled", primary: false, dialog: "cancel" });
  } else if (s === "accepted") {
    all.push({ id: "start", to: "preparing", primary: true });
  } else if (s === "preparing") {
    all.push({ id: "ready", to: "ready", primary: true });
  } else if (s === "ready") {
    if (o.type === "delivery") all.push({ id: "hand_to_driver", to: "out_for_delivery", primary: true, dialog: "driver" });
    else all.push({ id: "handed_out", to: "picked_up", primary: true, dialog: needsCashConfirm(o, "picked_up") ? "cash" : undefined });
  } else if (s === "out_for_delivery") {
    all.push({ id: "delivered", to: "delivered", primary: true, dialog: needsCashConfirm(o, "delivered") ? "cash" : undefined });
  } else if ((s === "delivered" || s === "picked_up") && o.payment_status === "paid") {
    all.push({ id: "refund", to: "refunded", primary: false, dialog: "refund" });
  }
  if (ACTIVE.includes(s) && s !== "new") all.push({ id: "cancel", to: "cancelled", primary: false, dialog: "cancel" });

  return all.filter((a) => {
    if (!transitionAllowed(s, a.to, o.type, o.payment_status)) return false;
    if (role === "kitchen") return a.to === "preparing" || a.to === "ready";
    if (role === "driver") return a.to === "delivered" && !!uid && o.driver_id === uid;
    return true;
  });
}

/** Column heading counters for "In Arbeit". */
export function inProgressStats(rows: Order[], now: Date): { newCount: number; overdue: number } {
  let newCount = 0;
  let overdue = 0;
  for (const o of rows) {
    if (o.status === "new") newCount++;
    const t = timerFor(o, now);
    if (t.kind === "cooking" && t.overdue) overdue++;
  }
  return { newCount, overdue };
}

/** Kitchen load placeholder: orders in the kitchen vs. a nominal capacity (design: "72 %"). */
export function kitchenLoad(orders: Order[], capacity = 8): number {
  const n = orders.filter((o) => o.status === "accepted" || o.status === "preparing").length;
  return Math.min(100, Math.round((n / capacity) * 100));
}

/** Ø prep of today's orders that reached ready (preparing_at → ready_at). */
export function avgPrepMinutes(orders: Order[], now: Date): number | null {
  const today = dayKey(now);
  const m = orders
    .filter((o) => o.preparing_at && o.ready_at && dayKey(new Date(o.ready_at)) === today)
    .map((o) => minutesBetween(o.preparing_at, o.ready_at) ?? 0);
  return m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : null;
}

/** A row's total for "Bar bei Lieferung" when cash and unpaid. */
export function cashToCollect(o: Pick<Order, "payment_method" | "payment_status" | "total_cents">): number | null {
  if (o.payment_method !== "cash") return null;
  if (o.payment_status === "paid" || o.payment_status === "refunded") return null;
  return o.total_cents;
}

/**
 * The VAT rate **this order was actually charged at**, derived from its own money columns.
 *
 * Not read from `menu_items`: the rate that matters is the one the server already baked into
 * `orders.vat_cents`, and `order_items` carries no rate snapshot, so a lookup could disagree with
 * the number rendered next to it (and fails outright for a since-deleted item). Deriving from the
 * money is the one source that cannot contradict the figure on screen.
 *
 * The base is `subtotal − discount`: `quote_order` computes
 * `round(Σ line_total × p/(100+p) × (subtotal−discount)/subtotal)`, so the delivery fee and the tip
 * sit outside the VAT base. Inverting a single-rate order gives `p = 100 × vat / (base − vat)`.
 *
 * Returns `null` when there is nothing honest to say (no VAT, or a base that cannot be inverted) —
 * the caller then shows the amount with no rate rather than a made-up one.
 */
export function effectiveVatPct(o: Pick<Order, "subtotal_cents" | "discount_cents" | "vat_cents">): number | null {
  const gross = o.subtotal_cents - o.discount_cents;
  const net = gross - o.vat_cents;
  if (o.vat_cents <= 0 || gross <= 0 || net <= 0) return null;
  const pct = (100 * o.vat_cents) / net;
  // One `round()` over the whole order leaves sub-cent noise in the inversion, and German rates are
  // whole numbers — so snap when we are plainly on one, and keep a decimal when a genuinely
  // mixed-rate basket lands between two (items carry their own `vat_delivery_pct`).
  const nearest = Math.round(pct);
  return Math.abs(pct - nearest) <= 0.25 ? nearest : Math.round(pct * 10) / 10;
}

/** Merge a freshly fetched row into the list (or drop it when it's gone). */
export function upsertOrder(list: Order[], row: Order | null, id: string): Order[] {
  if (!row) return list.filter((o) => o.id !== id);
  const i = list.findIndex((o) => o.id === id);
  if (i === -1) return [row, ...list];
  const next = list.slice();
  next[i] = row;
  return next;
}
