// BO · Marketing logic (api-contracts §8.1–§8.4, §1.5). The two groups that matter most are the
// reach arithmetic — where the count and a future send must not be able to diverge — and the
// KPI availability rules, where a 0 and "no source" are different claims.
import { describe, expect, it } from "vitest";
import {
  AUTOMATION_KINDS, BODY_MAX, SEGMENT_PRESETS, SCHEDULING_IS_ALLOWED, TITLE_MAX,
  appliesTo, bestPromo, canSend, codesRedeemed, configOf, configToJson, discountRate,
  discountRateByWeekday, isAvailable, messageOf, messageToJson, normaliseCode, openRate, presetFor,
  promoRevenue, promoState, pushOpenRate, reachOf, reachableOn, segmentOf, segmentToJson,
  sendBlockers, sortAutomations, statsOf, usageFraction, usageLabel, validateCampaign, validatePromo,
  type AutomationRow, type CampaignRow, type MarketingOrder, type PromoRow, type ResolvedRecipient,
} from "@/lib/marketing";

const NOW = new Date("2026-10-11T12:00:00Z");

function promo(over: Partial<PromoRow> = {}): PromoRow {
  return {
    id: "p1", code: "SHOSHO10", kind: "percent", value: 10, min_order_cents: 0,
    applies_to: { scope: "all" }, usage_limit: null, used_count: 0,
    valid_from: null, valid_to: null, active: true,
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", ...over,
  } as PromoRow;
}

function campaign(stats: Record<string, number> = {}): CampaignRow {
  return {
    id: "c1", name: "Neue Bowls", channel: "push", segment: {}, message_de: {}, message_en: {},
    status: "sent", scheduled_for: null, sent_at: "2026-10-01T00:00:00Z", stats,
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  };
}

function order(over: Partial<MarketingOrder> = {}): MarketingOrder {
  return { created_at: "2026-10-05T12:00:00Z", status: "delivered", total_cents: 4000, discount_cents: 0, promo_code: null, ...over };
}

const FROM = new Date("2026-09-11T12:00:00Z");
const TO = NOW;

/* ================================================================ promo codes (§1.5) */

describe("promoState", () => {
  it("is live when active, in window and under its limit", () => {
    expect(promoState(promo(), NOW)).toBe("live");
  });

  it("inactive beats everything", () => {
    expect(promoState(promo({ active: false, valid_to: "2026-12-01T00:00:00Z" }), NOW)).toBe("inactive");
  });

  it("exhausted is its own state, not 'expired'", () => {
    // The design dims an exhausted code and reddens its counter: raising the limit is a different
    // decision from extending a date.
    expect(promoState(promo({ usage_limit: 500, used_count: 500 }), NOW)).toBe("exhausted");
    expect(promoState(promo({ usage_limit: 500, used_count: 501 }), NOW)).toBe("exhausted");
    expect(promoState(promo({ usage_limit: 500, used_count: 499 }), NOW)).toBe("live");
  });

  it("an unlimited code is never exhausted", () => {
    expect(promoState(promo({ usage_limit: null, used_count: 99999 }), NOW)).toBe("live");
  });

  it("checks exhaustion before the window, because a used-up code is the more actionable fact", () => {
    expect(promoState(promo({ usage_limit: 1, used_count: 1, valid_to: "2026-01-01T00:00:00Z" }), NOW)).toBe("exhausted");
  });

  it("scheduled and expired", () => {
    expect(promoState(promo({ valid_from: "2026-11-01T00:00:00Z" }), NOW)).toBe("scheduled");
    expect(promoState(promo({ valid_to: "2026-10-01T00:00:00Z" }), NOW)).toBe("expired");
  });
});

describe("usage labels", () => {
  it("shows ∞ for an unlimited code", () => {
    expect(usageLabel({ used_count: 184, usage_limit: null }, "en")).toBe("184 / ∞");
  });

  it("groups thousands in the reader's locale", () => {
    expect(usageLabel({ used_count: 312, usage_limit: 1000 }, "en")).toBe("312 / 1,000");
    expect(usageLabel({ used_count: 312, usage_limit: 1000 }, "de")).toBe("312 / 1.000");
  });

  it("usageFraction is null without a limit and clamps at 1", () => {
    expect(usageFraction({ used_count: 10, usage_limit: null })).toBeNull();
    expect(usageFraction({ used_count: 250, usage_limit: 500 })).toBe(0.5);
    expect(usageFraction({ used_count: 600, usage_limit: 500 })).toBe(1);
  });
});

describe("promo validation mirrors the table's CHECK constraints", () => {
  it("upper-cases, because `check (code = upper(code))` would otherwise reject the insert", () => {
    expect(normaliseCode(" shosho10 ")).toBe("SHOSHO10");
    expect(normaliseCode("lunch 15")).toBe("LUNCH15");
  });

  it("requires a code and a positive value", () => {
    expect(validatePromo({ code: "", kind: "percent", value: 10 })).toEqual(["code"]);
    expect(validatePromo({ code: "X", kind: "percent", value: null })).toEqual(["value"]);
    expect(validatePromo({ code: "X", kind: "fixed", value: 0 })).toEqual(["value"]);
    expect(validatePromo({ code: "   ", kind: "fixed", value: -1 })).toEqual(["code", "value"]);
  });

  it("caps a percent at 100 but not a fixed amount in cents", () => {
    expect(validatePromo({ code: "X", kind: "percent", value: 101 })).toEqual(["value"]);
    expect(validatePromo({ code: "X", kind: "percent", value: 100 })).toEqual([]);
    expect(validatePromo({ code: "X", kind: "fixed", value: 50000 })).toEqual([]);
  });
});

describe("applies_to", () => {
  it("defaults to the whole menu", () => {
    expect(appliesTo(null).scope).toBe("all");
    expect(appliesTo("nonsense").scope).toBe("all");
    expect(appliesTo({}).scope).toBe("all");
  });

  it("reads the seed's day/time window shape", () => {
    expect(appliesTo({ scope: "category", category_id: "c1", days: [1, 2, 3, 4, 5], until: "15:00" })).toEqual({
      scope: "category", category_id: "c1", days: [1, 2, 3, 4, 5], until: "15:00",
    });
  });

  it("drops weekday values outside 1..7 rather than passing them through", () => {
    expect(appliesTo({ days: [0, 1, 8, 7] }).days).toEqual([1, 7]);
  });

  it("falls back to `all` for an unknown scope instead of inventing one", () => {
    expect(appliesTo({ scope: "everything" }).scope).toBe("all");
  });
});

/* ================================================================ segments (§8.2) */

describe("segment round-trip", () => {
  it("drops the keys that were never set, so the stored jsonb says only what was chosen", () => {
    expect(segmentToJson({ min_orders: 3 })).toEqual({ min_orders: 3 });
    expect(segmentToJson({})).toEqual({});
    expect(segmentToJson({ tags: [] })).toEqual({});
    expect(segmentToJson({ customer_ids: [] })).toEqual({});
  });

  it("keeps `is_company: false`, which is a real filter, not an absence", () => {
    expect(segmentToJson({ is_company: false })).toEqual({ is_company: false });
  });

  it("survives a trip through the column", () => {
    const s = { min_orders: 3, max_days_silent: 30, tags: ["VIP"], is_company: true, customer_ids: ["a"] };
    expect(segmentOf(segmentToJson(s))).toMatchObject(s);
  });

  it("ignores junk in the column rather than throwing on an old row", () => {
    expect(segmentOf("nope")).toEqual({});
    expect(segmentOf({ min_orders: "three" })).toEqual({});
  });

  it("recognises the CRM's own tiles", () => {
    expect(presetFor({})).toBe("all");
    expect(presetFor({ min_orders: 3 })).toBe("regulars");
    expect(presetFor({ min_days_silent: 60 })).toBe("sleeping");
    expect(presetFor({ created_within_days: 30 })).toBe("new_this_month");
    expect(presetFor({ is_company: true })).toBe("companies");
    expect(presetFor({ customer_ids: ["a", "b"] })).toBe("manual");
    // A hand-tuned segment matches no tile, and the UI must not pretend it does.
    expect(presetFor({ min_orders: 5, max_days_silent: 10 })).toBeNull();
  });

  it("every preset is expressible in §8.2's documented keys", () => {
    const allowed = new Set(["tags", "is_company", "min_orders", "max_orders", "min_days_silent", "max_days_silent", "created_within_days", "customer_ids"]);
    for (const p of SEGMENT_PRESETS) {
      for (const k of Object.keys(p.segment)) expect(allowed.has(k)).toBe(true);
    }
  });
});

/* ================================================================ reach (task 6) */

describe("reach comes from resolve_segment's rows and nothing else", () => {
  const rows: ResolvedRecipient[] = [
    { customer_id: "1", has_push_consent: true, has_email_consent: false },
    { customer_id: "2", has_push_consent: true, has_email_consent: true },
    { customer_id: "3", has_push_consent: false, has_email_consent: true },
    { customer_id: "4", has_push_consent: true, has_email_consent: false },
  ];

  it("decomposes the consent split", () => {
    expect(reachOf(rows)).toEqual({ reachable: 4, withPush: 3, withEmail: 2, withBoth: 1, pushOnly: 2, emailOnly: 1 });
  });

  it("every per-channel figure is derived from the SAME rows — the count cannot diverge from a send", () => {
    const r = reachOf(rows);
    expect(reachableOn(r, "push")).toBe(3);
    expect(reachableOn(r, "email")).toBe(2);
    // A `both` resolve returns everyone with EITHER consent, which is the row count itself.
    expect(reachableOn(r, "both")).toBe(4);
  });

  it("an empty segment is zero across every channel, not an error", () => {
    const r = reachOf([]);
    expect(r.reachable).toBe(0);
    expect(reachableOn(r, "push")).toBe(0);
    expect(reachableOn(r, "email")).toBe(0);
    expect(reachableOn(r, "both")).toBe(0);
  });

  it("never reports more reachable on a channel than the resolver returned", () => {
    // "A caller who forgets consent gets fewer rows, never more" — the UI must not undo that.
    const r = reachOf(rows);
    for (const ch of ["push", "email", "both"] as const) {
      expect(reachableOn(r, ch)).toBeLessThanOrEqual(r.reachable);
    }
  });
});

/* ================================================================ sending (task 7) */

describe("sending is impossible on every channel, and each blocker is named", () => {
  it("no channel can send", () => {
    expect(canSend("push")).toBe(false);
    expect(canSend("email")).toBe(false);
    expect(canSend("both")).toBe(false);
  });

  it("every channel carries the missing sender (S5 has never started)", () => {
    for (const ch of ["push", "email", "both"] as const) {
      expect(sendBlockers(ch)).toContain("no_sender");
    }
  });

  it("push additionally has no subscription store; email additionally has no SMTP (D-017)", () => {
    expect(sendBlockers("push")).toEqual(["no_sender", "no_push_store"]);
    expect(sendBlockers("email")).toEqual(["no_sender", "no_smtp"]);
    expect(sendBlockers("both")).toEqual(["no_sender", "no_push_store", "no_smtp"]);
  });

  it("scheduling IS allowed — it records intent on a row S5 will read", () => {
    expect(SCHEDULING_IS_ALLOWED).toBe(true);
  });
});

/* ================================================================ message */

describe("campaign message", () => {
  it("round-trips and trims", () => {
    expect(messageToJson({ title: "  Hallo  ", body: "Text", deep_link: "/sets" })).toEqual({ title: "Hallo", body: "Text", deep_link: "/sets" });
    expect(messageOf(messageToJson({ title: "A", body: "B" }))).toEqual({ title: "A", body: "B", deep_link: undefined });
  });

  it("drops empty fields rather than storing blanks", () => {
    expect(messageToJson({ title: "   ", body: "B" })).toEqual({ body: "B" });
  });

  it("requires a name and the German title and body before a campaign can be scheduled", () => {
    expect(validateCampaign({ name: "X", message_de: { title: "T", body: "B" } })).toEqual([]);
    expect(validateCampaign({ name: "", message_de: { title: "T", body: "B" } })).toEqual(["name"]);
    expect(validateCampaign({ name: "X", message_de: {} })).toEqual(["title_de", "body_de"]);
    // EN is optional: English customers fall back to the German text.
    expect(validateCampaign({ name: "X", message_de: { title: "T", body: "B" } })).toEqual([]);
  });

  it("push payload limits are the device's, not ours to invent", () => {
    expect(TITLE_MAX).toBe(40);
    expect(BODY_MAX).toBe(140);
  });
});

/* ================================================================ stats (§8.1) */

describe("campaign stats are null, not zero, until something sends", () => {
  it("an empty stats jsonb reads as unmeasured on every field", () => {
    expect(statsOf({})).toEqual({ recipients: null, delivered: null, opened: null, orders: null, revenue_cents: null });
  });

  it("reads real figures when a sender eventually writes them", () => {
    expect(statsOf({ recipients: 302, delivered: 302, opened: 184, orders: 41, revenue_cents: 128400 })).toEqual({
      recipients: 302, delivered: 302, opened: 184, orders: 41, revenue_cents: 128400,
    });
  });

  it("distinguishes a real zero from an absent figure", () => {
    expect(statsOf({ orders: 0 }).orders).toBe(0);
    expect(statsOf({}).orders).toBeNull();
  });

  it("openRate is null when either side is unmeasured or delivery was zero", () => {
    expect(openRate(statsOf({ delivered: 100, opened: 61 }))).toBe(61);
    expect(openRate(statsOf({ delivered: 0, opened: 0 }))).toBeNull();
    expect(openRate(statsOf({ opened: 10 }))).toBeNull();
    expect(openRate(statsOf({}))).toBeNull();
  });
});

/* ================================================================ automations (§8.4) */

describe("automations", () => {
  it("lists the four kinds the design names, in the design's order", () => {
    expect([...AUTOMATION_KINDS]).toEqual(["welcome", "win_back_45d", "birthday", "review_after_delivery"]);
    const rows = [
      { kind: "birthday" }, { kind: "welcome" }, { kind: "review_after_delivery" }, { kind: "win_back_45d" },
    ] as AutomationRow[];
    expect(sortAutomations(rows).map((r) => r.kind)).toEqual([...AUTOMATION_KINDS]);
  });

  it("round-trips the config jsonb §8.4 documents", () => {
    const c = { delay_hours: 2, message_de: "Hallo", message_en: "Hi", discount: 10 };
    expect(configOf(configToJson(c))).toEqual(c);
  });

  it("keeps a zero delay, which is a real setting", () => {
    expect(configToJson({ delay_hours: 0 })).toEqual({ delay_hours: 0 });
  });

  it("ignores junk in the column", () => {
    expect(configOf("nope")).toEqual({});
    expect(configOf({ delay_hours: "two" })).toEqual({});
  });
});

/* ================================================================ KPIs (task 9) */

describe("KPIs are a number or a stated reason — never a misleading zero", () => {
  const orders = [
    order({ promo_code: "SHOSHO10", discount_cents: 400, total_cents: 3600 }),
    order({ promo_code: null, discount_cents: 0, total_cents: 5000 }),
    order({ promo_code: "LUNCH15", discount_cents: 600, total_cents: 3400, status: "picked_up" }),
    order({ promo_code: "SHOSHO10", discount_cents: 400, total_cents: 3600, status: "cancelled" }),
  ];

  it("promo revenue counts completed orders that carried a code", () => {
    const k = promoRevenue(orders, FROM, TO);
    expect(isAvailable(k) && k.value).toBe(3600 + 3400);
  });

  it("a cancelled order is not revenue", () => {
    const k = promoRevenue([order({ promo_code: "X", status: "cancelled", total_cents: 9999 })], FROM, TO);
    // No completed order at all in the window → unavailable, not 0 €.
    expect(isAvailable(k)).toBe(false);
  });

  it("codes redeemed counts the orders, not the sum of used_count", () => {
    const k = codesRedeemed(orders, FROM, TO);
    expect(isAvailable(k) && k.value).toBe(2);
  });

  it("discount rate is the share of completed orders carrying a discount, as the design's caption says", () => {
    const k = discountRate(orders, FROM, TO);
    // 3 completed, 2 of them discounted.
    expect(isAvailable(k) && Math.round((k.value as number) * 10) / 10).toBe(66.7);
  });

  it("with no completed orders every order-derived KPI says why, instead of reading 0", () => {
    for (const k of [promoRevenue([], FROM, TO), codesRedeemed([], FROM, TO), discountRate([], FROM, TO)]) {
      expect(isAvailable(k)).toBe(false);
      expect(k).toEqual({ unavailable: "no_orders" });
    }
  });

  it("zero PROMO orders among real orders is a genuine 0 — that distinction is the whole point", () => {
    const k = promoRevenue([order({ promo_code: null })], FROM, TO);
    expect(isAvailable(k) && k.value).toBe(0);
  });

  it("push open rate has NO source and says so — no campaign has ever been sent", () => {
    expect(pushOpenRate([])).toEqual({ unavailable: "no_sender" });
    expect(pushOpenRate([campaign()])).toEqual({ unavailable: "no_sender" });
  });

  it("push open rate becomes real the moment a sender writes stats, with no UI change", () => {
    const k = pushOpenRate([campaign({ delivered: 100, opened: 61 })]);
    expect(isAvailable(k) && k.value).toBe(61);
  });

  it("ignores orders outside the window", () => {
    const old = order({ created_at: "2026-01-01T00:00:00Z", promo_code: "X" });
    expect(isAvailable(codesRedeemed([old], FROM, TO))).toBe(false);
  });
});

describe("discount rate by weekday", () => {
  it("returns null for a weekday with no completed orders, not 0 %", () => {
    // 2026-10-05 is a Monday, 2026-10-06 a Tuesday (Europe/Berlin).
    const series = discountRateByWeekday(
      [order({ created_at: "2026-10-05T12:00:00Z", discount_cents: 400 }), order({ created_at: "2026-10-06T12:00:00Z", discount_cents: 0 })],
      FROM, TO,
    );
    expect(series[0]).toBe(100);
    expect(series[1]).toBe(0);
    expect(series[2]).toBeNull();
    expect(series).toHaveLength(7);
  });

  it("is all null with no orders", () => {
    expect(discountRateByWeekday([], FROM, TO)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("best promotion", () => {
  it("ranks by revenue and reports ROI against the discount given away", () => {
    const best = bestPromo(
      [
        order({ promo_code: "LUNCH15", total_cents: 100000, discount_cents: 15000 }),
        order({ promo_code: "SHOSHO10", total_cents: 5000, discount_cents: 500 }),
      ],
      FROM, TO,
    );
    expect(best?.code).toBe("LUNCH15");
    expect(best?.redemptions).toBe(1);
    expect(best?.roi).toBeCloseTo(100000 / 15000);
  });

  it("aggregates per code, case-insensitively", () => {
    const best = bestPromo([order({ promo_code: "lunch15", total_cents: 1000, discount_cents: 100 }), order({ promo_code: "LUNCH15", total_cents: 2000, discount_cents: 200 })], FROM, TO);
    expect(best?.code).toBe("LUNCH15");
    expect(best?.redemptions).toBe(2);
    expect(best?.revenueCents).toBe(3000);
  });

  it("reports no ROI rather than an infinite one when no discount was recorded", () => {
    const best = bestPromo([order({ promo_code: "FREE", total_cents: 1000, discount_cents: 0 })], FROM, TO);
    expect(best?.roi).toBeNull();
  });

  it("is null when nothing was redeemed", () => {
    expect(bestPromo([order({ promo_code: null })], FROM, TO)).toBeNull();
    expect(bestPromo([], FROM, TO)).toBeNull();
  });
});
