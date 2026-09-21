// Mock data layer (NEXT_PUBLIC_API=mock): the seed in memory + a faithful re-implementation of
// quote_order / place_order / get_order_by_token so the UI can be built and tested without Supabase.
// This is the ONLY place the site computes prices — the real site takes totals from the RPC.
import type { ShoshoApi } from "./api";
import { berlinParts, isOpenAt } from "./hours";
import { MOCK_CATEGORIES, MOCK_ITEMS, MOCK_ITEM_OPTION_GROUPS, MOCK_OPS, MOCK_PROMOS, MOCK_SETTINGS, MOCK_ZONES } from "./mock-data";
import {
  OrderRejectedError,
  type Catalog,
  type OrderStatus,
  type PlaceOrderPayload,
  type PlaceOrderResult,
  type Problem,
  type Quote,
  type QuoteLine,
  type QuotePayload,
  type TrackedOrder,
} from "./types";

type StoredOrder = TrackedOrder & { tracking_token: string; phone: string };

const STORAGE_KEY = "shosho.mock.orders.v1";

function loadOrders(): StoredOrder[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredOrder[];
  } catch {
    return [];
  }
}
function saveOrders(orders: StoredOrder[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  } catch {
    /* private mode */
  }
}

export function normalizePhone(raw: string | undefined): string | null {
  let p = (raw ?? "").replace(/[\s\-().\/]/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  else if (p.startsWith("0")) p = "+49" + p.slice(1);
  return /^\+[1-9][0-9]{6,14}$/.test(p) ? p : null;
}

export type MockOptions = { now?: () => Date; paused?: boolean; orders?: StoredOrder[] };

export function createMockApi(opts: MockOptions = {}): ShoshoApi {
  const now = opts.now ?? (() => new Date());
  let orders: StoredOrder[] | null = opts.orders ?? null;
  const getOrders = () => (orders ??= loadOrders());
  const seq = 1000;

  const catalog: Catalog = {
    categories: MOCK_CATEGORIES,
    items: MOCK_ITEMS,
    itemOptionGroups: MOCK_ITEM_OPTION_GROUPS,
    zones: MOCK_ZONES,
    settings: { ...MOCK_SETTINGS, kitchen_status: { paused: opts.paused ?? false, since: opts.paused ? now().toISOString() : null } },
    online: true,
  };

  function quote(payload: QuotePayload): Quote {
    const problems: Problem[] = [];
    let type = payload.type;
    if (type !== "delivery" && type !== "pickup") {
      problems.push({ code: "invalid_input", field: "type" });
      type = "pickup";
    }
    const at = now();
    const sched = payload.scheduled_for ? new Date(payload.scheduled_for) : null;
    const loc = berlinParts(sched ?? at);
    const lines: QuoteLine[] = [];
    let subtotal = 0;
    let vatLines = 0;
    const catTot: Record<string, number> = {};

    for (const r of Array.isArray(payload.items) ? payload.items : []) {
      const qty = r.qty ?? 1;
      if (!r.item_id || qty < 1) {
        problems.push({ code: "invalid_input", field: "items", item_id: r.item_id });
        continue;
      }
      const it = MOCK_ITEMS.find((i) => i.id === r.item_id);
      if (!it) {
        problems.push({ code: "unavailable", item_id: r.item_id });
        continue;
      }
      if (it.max_per_order != null && qty > it.max_per_order) {
        problems.push({ code: "unavailable", item_id: it.id, reason: "max_per_order", max: it.max_per_order });
        continue;
      }
      const groups = MOCK_ITEM_OPTION_GROUPS.find((x) => x.item_id === it.id)?.groups ?? [];
      const optIds = r.option_ids ?? [];
      const known = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
      for (const id of optIds) if (!known.has(id)) problems.push({ code: "invalid_options", item_id: it.id, option_id: id });
      const lineOpts: QuoteLine["options"] = [];
      let optSum = 0;
      for (const grp of groups) {
        const sel = grp.options.filter((o) => optIds.includes(o.id));
        const n = sel.length;
        if ((grp.required && n < Math.max(grp.min_select, 1)) || n < grp.min_select || (grp.max_select != null && n > grp.max_select)) {
          problems.push({ code: "invalid_options", item_id: it.id, group_id: grp.id, min: grp.min_select, max: grp.max_select, selected: n });
        }
        for (const o of sel) {
          lineOpts.push({ group_id: grp.id, group: grp.name_en, group_de: grp.name_de, option_id: o.id, option: o.name_en, option_de: o.name_de, price_cents: o.price_cents });
          optSum += o.price_cents;
        }
      }
      const lineTotal = (it.base_price_cents + optSum) * qty;
      subtotal += lineTotal;
      vatLines += (lineTotal * 7) / 107;
      catTot[it.category_id] = (catTot[it.category_id] ?? 0) + lineTotal;
      lines.push({
        item_id: it.id, sku: it.sku, category_id: it.category_id, name: it.name_en, name_de: it.name_de, name_en: it.name_en, name_ja: it.name_ja,
        qty, unit_price_cents: it.base_price_cents, options: lineOpts, options_cents: optSum, line_total_cents: lineTotal,
        prep_minutes: it.prep_minutes, allergens: it.allergens,
      });
    }
    if (lines.length === 0) problems.push({ code: "empty_cart" });

    // time / kitchen
    if (!sched) {
      if (catalog.settings.kitchen_status?.paused) problems.push({ code: "closed", reason: "kitchen_paused" });
      else if (!isOpenAt(catalog.settings.opening_hours, at)) problems.push({ code: "closed", reason: "outside_hours" });
    } else if (sched.getTime() < at.getTime() + 15 * 60_000) problems.push({ code: "closed", reason: "slot_too_soon" });
    else if (sched.getTime() > at.getTime() + MOCK_OPS.preorder_max_days * 86_400_000) problems.push({ code: "closed", reason: "slot_too_far" });
    else if (!isOpenAt(catalog.settings.opening_hours, sched)) problems.push({ code: "closed", reason: "slot_outside_hours" });

    // zone / fee / pickup
    let zone: Quote["zone"] = null;
    let fee = 0;
    let pickupDisc = 0;
    let promised: number | null = null;
    if (type === "delivery") {
      const postal = payload.postal_code?.trim();
      if (!postal) problems.push({ code: "out_of_zone", reason: "postal_code_missing" });
      else {
        const z = MOCK_ZONES.find((z) => z.postal_codes.includes(postal));
        if (!z) problems.push({ code: "out_of_zone", postal_code: postal });
        else {
          zone = { id: `zone-${z.code}`, code: z.code, name: z.name, min_order_cents: z.min_order_cents, fee_cents: z.fee_cents, free_delivery_over_cents: z.free_delivery_over_cents, promised_minutes: z.promised_minutes };
          if (subtotal < z.min_order_cents) problems.push({ code: "below_min_order", min_order_cents: z.min_order_cents, subtotal_cents: subtotal });
          fee = z.free_delivery_over_cents != null && subtotal >= z.free_delivery_over_cents ? 0 : z.fee_cents;
          promised = z.promised_minutes;
        }
      }
    } else {
      pickupDisc = Math.round((subtotal * MOCK_OPS.pickup_discount_pct) / 100);
      promised = MOCK_OPS.prep_default_min;
    }

    // promo
    let promo: Quote["promo"] = null;
    let promoDisc = 0;
    const code = payload.promo_code?.trim().toUpperCase();
    if (code) {
      const p = MOCK_PROMOS.find((x) => x.code === code);
      let bad: string | null = null;
      if (!p) bad = "unknown";
      else if (subtotal < p.min_order_cents) bad = "min_order";
      else if (p.days && !p.days.includes(loc.dow === 0 ? 7 : loc.dow)) bad = "wrong_day";
      else if (p.until && loc.time >= p.until) bad = "too_late";
      else if (p.scope === "first_order") {
        const phone = normalizePhone(payload.contact?.phone);
        if (phone && getOrders().some((o) => o.phone === phone && !["cancelled", "refunded"].includes(o.status))) bad = "not_first_order";
      }
      if (!bad && p) {
        promoDisc = p.kind === "percent" ? Math.round((subtotal * p.value) / 100) : Math.min(p.value, subtotal);
        promo = { code: p.code, kind: p.kind, value: p.value, discount_cents: promoDisc, scope: p.scope };
      } else problems.push({ code: "promo_invalid", promo_code: code, reason: bad ?? "unknown" });
    }

    const tip = Math.max(payload.tip_cents ?? 0, 0);
    const discount = Math.min(subtotal, pickupDisc + promoDisc);
    const total = subtotal - discount + fee + tip;
    const vat = Math.round((subtotal > 0 ? (vatLines * (subtotal - discount)) / subtotal : 0) + (fee * 19) / 119);
    return {
      ok: problems.length === 0, type, scheduled_for: sched ? sched.toISOString() : null, lines,
      subtotal_cents: subtotal, pickup_discount_cents: pickupDisc, promo_discount_cents: promoDisc, discount_cents: discount,
      delivery_fee_cents: fee, tip_cents: tip, total_cents: total, vat_cents: vat, zone, promised_minutes: promised, promo, problems,
    };
  }

  /** Demo progression so the tracking page moves: new → accepted → preparing → ready → out → delivered. */
  function progressed(o: StoredOrder): StoredOrder {
    if (["cancelled", "refunded", "delivered", "picked_up"].includes(o.status)) return o;
    const created = new Date(o.created_at).getTime();
    const elapsed = (now().getTime() - created) / 60_000;
    const steps: [number, OrderStatus, keyof StoredOrder][] = [
      [1, "accepted", "accepted_at"], [3, "preparing", "preparing_at"], [8, "ready", "ready_at"],
      [9, o.type === "delivery" ? "out_for_delivery" : "picked_up", o.type === "delivery" ? "out_at" : "completed_at"],
      [14, "delivered", "completed_at"],
    ];
    const events = [...o.events];
    const next: StoredOrder = { ...o, events };
    for (const [min, status, stamp] of steps) {
      if (elapsed < min) break;
      if (o.type === "pickup" && status === "delivered") break;
      const at = new Date(created + min * 60_000).toISOString();
      if (!events.some((e) => e.type === (status === "out_for_delivery" ? "handed_to_driver" : status))) {
        events.push({ at, type: status === "out_for_delivery" ? "handed_to_driver" : status });
      }
      (next as Record<string, unknown>)[stamp] = at;
      next.status = status;
    }
    const finished = ["delivered", "picked_up"].includes(next.status);
    next.eta = finished ? null : next.scheduled_for ?? new Date(new Date(next.preparing_at ?? next.accepted_at ?? next.created_at).getTime() + (next.promised_minutes ?? 0) * 60_000).toISOString();
    if (finished) next.payment_status = "paid";
    return next;
  }

  return {
    async getCatalog() {
      return catalog;
    },
    async quoteOrder(payload) {
      await new Promise((r) => setTimeout(r, 120));
      return quote(payload);
    },
    async placeOrder(payload: PlaceOrderPayload) {
      const problems: Problem[] = [];
      const name = payload.contact?.name?.trim();
      const phone = normalizePhone(payload.contact?.phone);
      if (!name) problems.push({ code: "invalid_input", field: "contact.name" });
      if (!phone) problems.push({ code: "invalid_input", field: "contact.phone" });
      if (!payload.payment_method) problems.push({ code: "invalid_input", field: "payment_method" });
      let postal = payload.postal_code;
      if (payload.type === "delivery") {
        if (!payload.address?.street?.trim() || !payload.address?.postal_code?.trim()) problems.push({ code: "invalid_input", field: "address" });
        else postal = payload.address.postal_code.trim();
      }
      const q = quote({ ...payload, postal_code: postal, contact: { phone: phone ?? undefined } });
      problems.push(...q.problems);
      if (problems.length) throw new OrderRejectedError(problems);

      const createdAt = now().toISOString();
      const number = seq + getOrders().length + 1;
      const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      const order: StoredOrder = {
        order_id: crypto.randomUUID(), number, status: "new", type: q.type, payment_status: payload.payment_status ?? "pending",
        payment_method: payload.payment_method, scheduled_for: q.scheduled_for, promised_minutes: q.promised_minutes, eta: null,
        created_at: createdAt, accepted_at: null, preparing_at: null, ready_at: null, out_at: null, completed_at: null, cancelled_at: null,
        contact_name: name!, address: payload.type === "delivery" ? { ...payload.address!, city: payload.address?.city || "Berlin" } : null,
        courier_comment: payload.courier_comment?.trim() || null, comment_flags: payload.comment_flags ?? [],
        items: q.lines.map((l) => ({ name: l.name, qty: l.qty, unit_price_cents: l.unit_price_cents, options: l.options, line_total_cents: l.line_total_cents })),
        subtotal_cents: q.subtotal_cents, discount_cents: q.discount_cents, delivery_fee_cents: q.delivery_fee_cents, tip_cents: q.tip_cents,
        total_cents: q.total_cents, vat_cents: q.vat_cents, promo_code: q.promo?.code ?? null,
        events: [{ at: createdAt, type: "created" }], tracking_token: token, phone: phone!,
      };
      getOrders().push(order);
      saveOrders(getOrders());
      const result: PlaceOrderResult = { order_id: order.order_id, number, total_cents: order.total_cents, tracking_token: token, status: "new" };
      return result;
    },
    async getOrderByToken(token) {
      const o = getOrders().find((x) => x.tracking_token === token);
      if (!o) return null;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tracking_token, phone, ...pub } = progressed(o);
      return pub;
    },
  };
}
