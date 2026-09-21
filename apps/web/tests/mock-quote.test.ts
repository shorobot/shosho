// The mock re-implements quote_order (api-contracts §5.2). These tests pin the problem codes the UI
// handles; the same expectations run against the real RPC in tests/integration/.
import { describe, expect, it } from "vitest";
import { createMockApi } from "@/lib/api-mock";
import { MOCK_GROUPS, MOCK_ITEMS } from "@/lib/mock-data";
import { OrderRejectedError } from "@/lib/types";

const philly = MOCK_ITEMS.find((i) => i.sku === "RL-014")!;
const ramen = MOCK_ITEMS.find((i) => i.sku === "RM-001")!;
const size8 = MOCK_GROUPS.size!.options[0]!.id;
const size24 = MOCK_GROUPS.size!.options[2]!.id;
const soyClassic = MOCK_GROUPS.soy!.options[0]!.id;

// Wednesday 2026-09-23 13:00 Berlin (CEST, UTC+2) → open, weekday, before 15:00
const OPEN_NOW = () => new Date("2026-09-23T11:00:00Z");
const CLOSED_NOW = () => new Date("2026-09-23T02:00:00Z");

describe("mock quote_order", () => {
  it("prices lines with options and applies the zone by postal code", async () => {
    const api = createMockApi({ now: OPEN_NOW, orders: [] });
    const q = await api.quoteOrder({ type: "delivery", postal_code: "10119", items: [{ item_id: philly.id, qty: 2, option_ids: [size24, soyClassic] }] });
    expect(q.ok).toBe(true);
    expect(q.lines[0]?.line_total_cents).toBe((1490 + 2700) * 2);
    expect(q.zone?.code).toBe("A");
    expect(q.delivery_fee_cents).toBe(0); // 83.80 € ≥ free over 35 €
    expect(q.total_cents).toBe(8380);
  });

  it("flags missing required groups as invalid_options", async () => {
    const api = createMockApi({ now: OPEN_NOW, orders: [] });
    const q = await api.quoteOrder({ type: "pickup", items: [{ item_id: philly.id, qty: 1, option_ids: [] }] });
    expect(q.ok).toBe(false);
    expect(q.problems.filter((p) => p.code === "invalid_options").map((p) => p.group_id).sort()).toEqual([MOCK_GROUPS.size!.id, MOCK_GROUPS.soy!.id].sort());
  });

  it("pickup gets the discount; delivery below the zone minimum is a problem", async () => {
    const api = createMockApi({ now: OPEN_NOW, orders: [] });
    const pickup = await api.quoteOrder({ type: "pickup", items: [{ item_id: ramen.id, qty: 1 }] });
    expect(pickup.pickup_discount_cents).toBe(135);
    expect(pickup.total_cents).toBe(1350 - 135);
    const zoneC = await api.quoteOrder({ type: "delivery", postal_code: "10961", items: [{ item_id: ramen.id, qty: 1 }] });
    expect(zoneC.problems).toContainEqual(expect.objectContaining({ code: "below_min_order", min_order_cents: 3000 }));
    expect(zoneC.delivery_fee_cents).toBe(490);
  });

  it("reports out_of_zone and postal_code_missing", async () => {
    const api = createMockApi({ now: OPEN_NOW, orders: [] });
    const missing = await api.quoteOrder({ type: "delivery", items: [{ item_id: ramen.id, qty: 1 }] });
    expect(missing.problems).toContainEqual({ code: "out_of_zone", reason: "postal_code_missing" });
    const outside = await api.quoteOrder({ type: "delivery", postal_code: "20095", items: [{ item_id: ramen.id, qty: 1 }] });
    expect(outside.problems).toContainEqual({ code: "out_of_zone", postal_code: "20095" });
  });

  it("closed outside hours for ASAP, fine for a valid slot, slot_too_soon otherwise", async () => {
    const api = createMockApi({ now: CLOSED_NOW, orders: [] });
    const asap = await api.quoteOrder({ type: "pickup", items: [{ item_id: ramen.id, qty: 1 }] });
    expect(asap.problems).toContainEqual({ code: "closed", reason: "outside_hours" });
    const slot = await api.quoteOrder({ type: "pickup", items: [{ item_id: ramen.id, qty: 1 }], scheduled_for: "2026-09-23T10:00:00Z" });
    expect(slot.problems).toEqual([]);
    const soon = await api.quoteOrder({ type: "pickup", items: [{ item_id: ramen.id, qty: 1 }], scheduled_for: "2026-09-23T02:05:00Z" });
    expect(soon.problems).toContainEqual({ code: "closed", reason: "slot_too_soon" });
  });

  it("kitchen paused blocks ASAP orders", async () => {
    const api = createMockApi({ now: OPEN_NOW, paused: true, orders: [] });
    const q = await api.quoteOrder({ type: "pickup", items: [{ item_id: ramen.id, qty: 1 }] });
    expect(q.problems).toContainEqual({ code: "closed", reason: "kitchen_paused" });
  });

  it("promo codes: percent, min order, unknown, lunch window", async () => {
    const api = createMockApi({ now: OPEN_NOW, orders: [] });
    const ok = await api.quoteOrder({ type: "pickup", promo_code: "shosho10", items: [{ item_id: philly.id, qty: 2, option_ids: [size8, soyClassic] }] });
    expect(ok.promo?.code).toBe("SHOSHO10");
    expect(ok.promo_discount_cents).toBe(298);
    const min = await api.quoteOrder({ type: "pickup", promo_code: "SHOSHO10", items: [{ item_id: ramen.id, qty: 1 }] });
    expect(min.problems).toContainEqual(expect.objectContaining({ code: "promo_invalid", reason: "min_order" }));
    const unknown = await api.quoteOrder({ type: "pickup", promo_code: "NOPE", items: [{ item_id: ramen.id, qty: 1 }] });
    expect(unknown.problems).toContainEqual(expect.objectContaining({ code: "promo_invalid", reason: "unknown" }));
    const lunch = await api.quoteOrder({ type: "pickup", promo_code: "LUNCH15", items: [{ item_id: ramen.id, qty: 2 }] });
    expect(lunch.promo_discount_cents).toBe(405);
    const late = createMockApi({ now: () => new Date("2026-09-23T14:00:00Z"), orders: [] });
    const lateQ = await late.quoteOrder({ type: "pickup", promo_code: "LUNCH15", items: [{ item_id: ramen.id, qty: 2 }] });
    expect(lateQ.problems).toContainEqual(expect.objectContaining({ code: "promo_invalid", reason: "too_late" }));
  });
});

describe("mock place_order / get_order_by_token", () => {
  it("rejects with the problems, then creates an order that the token resolves", async () => {
    const api = createMockApi({ now: OPEN_NOW, orders: [] });
    await expect(api.placeOrder({ type: "delivery", items: [{ item_id: ramen.id, qty: 1 }], contact: { name: "", phone: "1" }, payment_method: "cash" })).rejects.toBeInstanceOf(OrderRejectedError);
    try {
      await api.placeOrder({ type: "delivery", items: [{ item_id: ramen.id, qty: 1 }], contact: { name: "", phone: "1" }, payment_method: "cash" });
    } catch (e) {
      const codes = (e as OrderRejectedError).problems.map((p) => p.field ?? p.code);
      expect(codes).toEqual(expect.arrayContaining(["contact.name", "contact.phone", "address"]));
    }
    const res = await api.placeOrder({
      type: "delivery",
      items: [{ item_id: ramen.id, qty: 2 }],
      contact: { name: "Anna Weber", phone: "0176 123 45 67" },
      address: { street: "Torstraße 128", postal_code: "10119" },
      payment_method: "cash",
      comment_flags: ["leave_at_door"],
    });
    expect(res.number).toBeGreaterThanOrEqual(1001);
    expect(res.tracking_token).toHaveLength(32);
    const o = await api.getOrderByToken(res.tracking_token);
    expect(o?.number).toBe(res.number);
    expect(o?.total_cents).toBe(2700);
    expect(o?.status).toBe("new");
    expect(o?.events.map((e) => e.type)).toEqual(["created"]);
    expect(await api.getOrderByToken("nope")).toBeNull();
  });
});
