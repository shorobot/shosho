import { describe, expect, it } from "vitest";
import { cartReducer, emptyCart, lineKey, quotePayloadFor } from "@/lib/cart";
import { berlinToUtc, hoursSummary, isOpenAt, nextOpening, upcomingSlots } from "@/lib/hours";
import { euro, euroShort } from "@/lib/money";
import { closedReason, problemSummary, promoReason } from "@/lib/problems";
import { findItemBySlug, itemSlug } from "@/lib/slug";
import { MOCK_ITEMS, MOCK_SETTINGS } from "@/lib/mock-data";
import { defaultOptionIds, groupKind, optionsValid } from "@/lib/options";
import { MOCK_GROUPS } from "@/lib/mock-data";

describe("money", () => {
  it("formats cents the design way", () => {
    expect(euro(1490)).toBe("14.90 €");
    expect(euro(-420)).toBe("−4.20 €");
    expect(euro(5)).toBe("0.05 €");
    expect(euroShort(3500)).toBe("35 €");
    expect(euroShort(3550)).toBe("35.50 €");
  });
});

describe("slug", () => {
  it("round-trips through the sku suffix", () => {
    const philly = MOCK_ITEMS.find((i) => i.sku === "RL-014")!;
    expect(itemSlug(philly)).toBe("philadelphia-deluxe-rl-014");
    expect(findItemBySlug(MOCK_ITEMS, "philadelphia-deluxe-rl-014")?.id).toBe(philly.id);
    expect(findItemBySlug(MOCK_ITEMS, "renamed-rl-014")?.id).toBe(philly.id);
    expect(findItemBySlug(MOCK_ITEMS, "RL-014")?.id).toBe(philly.id);
    expect(findItemBySlug(MOCK_ITEMS, "nothing")).toBeUndefined();
  });
});

describe("cart reducer", () => {
  const line = { item_id: "a", qty: 1, option_ids: ["o2", "o1"], name: "A", name_ja: null, options_label: "" };
  it("merges identical configurations and removes at qty 0", () => {
    let s = cartReducer(emptyCart, { type: "add", line });
    s = cartReducer(s, { type: "add", line: { ...line, option_ids: ["o1", "o2"], qty: 2 } });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.qty).toBe(3);
    expect(s.lines[0]?.key).toBe(lineKey("a", ["o1", "o2"]));
    s = cartReducer(s, { type: "setQty", key: s.lines[0]!.key, qty: 0 });
    expect(s.lines).toHaveLength(0);
  });
  it("builds the quote payload from state (postal code only for delivery)", () => {
    let s = cartReducer(emptyCart, { type: "add", line });
    s = cartReducer(s, { type: "setAddress", address: { postal_code: " 10119 " } });
    s = cartReducer(s, { type: "setPromo", code: "shosho10" });
    expect(quotePayloadFor(s)).toMatchObject({ type: "delivery", postal_code: "10119", promo_code: "SHOSHO10", items: [{ item_id: "a", qty: 1 }] });
    s = cartReducer(s, { type: "setType", orderType: "pickup" });
    expect(quotePayloadFor(s).postal_code).toBeUndefined();
    expect(cartReducer(s, { type: "clear" })).toMatchObject({ lines: [], type: "pickup", address: { postal_code: " 10119 " } });
  });
});

describe("hours", () => {
  const hours = MOCK_SETTINGS.opening_hours;
  it("mirrors shop_open_at in Europe/Berlin", () => {
    expect(isOpenAt(hours, new Date("2026-09-23T11:00:00Z"))).toBe(true); // Wed 13:00
    expect(isOpenAt(hours, new Date("2026-09-23T02:00:00Z"))).toBe(false); // Wed 04:00
    expect(isOpenAt(hours, new Date("2026-09-26T21:59:00Z"))).toBe(true); // Sat 23:59 (until 24:00)
    expect(isOpenAt(hours, new Date("2026-09-27T20:30:00Z"))).toBe(false); // Sun 22:30 (closes 22:00)
    expect(isOpenAt({ ...hours!, holidays: ["2026-09-23"] }, new Date("2026-09-23T11:00:00Z"))).toBe(false);
  });
  it("converts Berlin wall time to UTC across DST", () => {
    expect(berlinToUtc("2026-09-23", "13:00").toISOString()).toBe("2026-09-23T11:00:00.000Z");
    expect(berlinToUtc("2026-12-23", "13:00").toISOString()).toBe("2026-12-23T12:00:00.000Z");
  });
  it("offers slots ≥ 15 min ahead on the half hour, inside opening hours", () => {
    const slots = upcomingSlots(hours, { at: new Date("2026-09-23T11:20:00Z"), limit: 3 }); // Wed 13:20
    expect(slots.map((s) => s.label)).toEqual(["14:00", "14:30", "15:00"]);
    const night = upcomingSlots(hours, { at: new Date("2026-09-23T21:00:00Z"), limit: 2 }); // Wed 23:00 → closed
    expect(night.map((s) => s.label)).toEqual(["Tomorrow 11:00", "Tomorrow 11:30"]);
  });
  it("finds the next opening and summarises hours for the footer", () => {
    expect(nextOpening(hours, new Date("2026-09-23T21:30:00Z"))).toEqual({ inDays: 1, time: "11:00" });
    expect(hoursSummary(hours, "de")).toEqual(["Mo–Do 11:00 — 23:00", "Fr–Sa 11:00 — 24:00", "So 12:00 — 22:00"]);
  });
});

describe("options", () => {
  it("classifies groups and picks defaults for required ones", () => {
    expect(groupKind(MOCK_GROUPS.size!)).toBe("segmented");
    expect(groupKind(MOCK_GROUPS.topping!)).toBe("checkbox");
    const groups = [MOCK_GROUPS.size!, MOCK_GROUPS.wasabi!, MOCK_GROUPS.soy!];
    const ids = defaultOptionIds(groups);
    expect(ids).toEqual([MOCK_GROUPS.size!.options[0]!.id, MOCK_GROUPS.soy!.options[0]!.id]);
    expect(optionsValid(groups, ids)).toBe(true);
    expect(optionsValid(groups, [])).toBe(false);
    expect(optionsValid([MOCK_GROUPS.topping!], MOCK_GROUPS.topping!.options.slice(0, 4).map((o) => o.id))).toBe(false);
  });
});

describe("problem copy", () => {
  it("names the reason", () => {
    expect(promoReason("not_first_order")).toMatch(/first orders/);
    expect(closedReason("kitchen_paused").title).toBe("Sold out today");
    expect(problemSummary({ code: "below_min_order", min_order_cents: 3000, subtotal_cents: 1350 })).toBe("Minimum order for your zone is 30.00 € — you're at 13.50 €.");
    expect(problemSummary({ code: "out_of_zone", postal_code: "20095" })).toMatch(/20095/);
  });
});
