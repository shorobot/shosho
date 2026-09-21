// End-to-end contract check through the real data layer (lib/api-supabase.ts) against a running
// Supabase with the S2-01 migrations + seed. Skipped unless NEXT_PUBLIC_SUPABASE_URL is set.
//   eval "$(pnpm --filter @shosho/backend exec supabase status -o env | sed 's/^/export /')"
//   NEXT_PUBLIC_SUPABASE_URL=$API_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY pnpm --filter @shosho/web test:integration
import { describe, expect, it } from "vitest";
import { createSupabaseApi } from "@/lib/api-supabase";
import { OrderRejectedError } from "@/lib/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const run = url ? describe : describe.skip;

run("web ↔ Supabase (api-contracts §5)", () => {
  const api = createSupabaseApi();

  it("reads the catalogue: on-sale items, categories, option groups, zones, public settings", async () => {
    const c = await api.getCatalog();
    expect(c.online).toBe(true);
    expect(c.categories.length).toBeGreaterThan(0);
    expect(c.items.length).toBeGreaterThan(0);
    expect(c.items.some((i) => i.sku === "MN-004")).toBe(false); // Ebi Tempura is stoplisted today in the seed
    const philly = c.items.find((i) => i.sku === "RL-014")!;
    expect(philly).toBeTruthy();
    const groups = c.itemOptionGroups.find((g) => g.item_id === philly.id)!.groups;
    expect(groups.map((g) => g.name_en)).toEqual(["Size", "Wasabi & ginger", "Soy sauce", "Extra topping", "Cutlery"]);
    expect(c.zones.map((z) => z.code)).toEqual(["A", "B", "C"]);
    expect(c.settings.business?.name).toBeTruthy();
    expect(c.settings.opening_hours?.mon).toBeTruthy();
    expect(c.settings.payments_enabled?.methods).toContain("cash");
    expect(c.settings.kitchen_status).toBeTruthy();
    expect(c.settings.site?.cookie_banner).toBeDefined();
  });

  it("quotes a cart: zone, pickup discount, promo, problems", async () => {
    const c = await api.getCatalog();
    const philly = c.items.find((i) => i.sku === "RL-014")!;
    const groups = c.itemOptionGroups.find((g) => g.item_id === philly.id)!.groups;
    const size = groups.find((g) => g.name_en === "Size")!.options[2]!.id; // 24 pcs +27.00
    const soy = groups.find((g) => g.name_en === "Soy sauce")!.options[0]!.id;
    const slot = new Date(Date.now() + 26 * 3600_000);
    slot.setUTCMinutes(0, 0, 0);
    // a slot tomorrow at 13:00 Berlin keeps the quote independent of the current time of day
    const scheduled = new Date(`${slot.toISOString().slice(0, 10)}T11:00:00Z`).toISOString();

    const delivery = await api.quoteOrder({ type: "delivery", postal_code: "10119", promo_code: "shosho10", scheduled_for: scheduled, items: [{ item_id: philly.id, qty: 2, option_ids: [size, soy] }] });
    expect(delivery.problems.filter((p) => p.code !== "closed")).toEqual([]);
    expect(delivery.lines[0]?.line_total_cents).toBe((1490 + 2700) * 2);
    expect(delivery.zone?.code).toBe("A");
    expect(delivery.delivery_fee_cents).toBe(0);
    expect(delivery.promo?.code).toBe("SHOSHO10");
    expect(delivery.promo_discount_cents).toBe(838);
    expect(delivery.total_cents).toBe(8380 - 838);

    const pickup = await api.quoteOrder({ type: "pickup", scheduled_for: scheduled, items: [{ item_id: philly.id, qty: 1, option_ids: [] }] });
    expect(pickup.problems.map((p) => p.code)).toContain("invalid_options");

    const outside = await api.quoteOrder({ type: "delivery", postal_code: "20095", scheduled_for: scheduled, items: [{ item_id: philly.id, qty: 1, option_ids: [groups[0]!.options[0]!.id, soy] }] });
    expect(outside.problems).toContainEqual(expect.objectContaining({ code: "out_of_zone", postal_code: "20095" }));
  });

  it("places a real order and tracks it by token", async () => {
    const c = await api.getCatalog();
    const ramen = c.items.find((i) => i.sku === "RM-001")!;
    const slot = new Date(Date.now() + 26 * 3600_000);
    const scheduled = new Date(`${slot.toISOString().slice(0, 10)}T11:00:00Z`).toISOString();
    const phone = `0176 ${String(Date.now()).slice(-7)}`;

    await expect(api.placeOrder({ type: "delivery", items: [{ item_id: ramen.id, qty: 1 }], scheduled_for: scheduled, contact: { name: "", phone }, payment_method: "cash" })).rejects.toSatisfy(
      (e: unknown) => e instanceof OrderRejectedError && e.problems.some((p) => p.code === "invalid_input" && p.field === "contact.name") && e.problems.some((p) => p.field === "address"),
    );

    const res = await api.placeOrder({
      type: "delivery",
      items: [{ item_id: ramen.id, qty: 2 }],
      scheduled_for: scheduled,
      contact: { name: "S3 Integration", phone },
      address: { street: "Torstraße 128", floor_apt: "3. OG", postal_code: "10119" },
      courier_comment: "integration test — ignore",
      comment_flags: ["leave_at_door", "no_wasabi"],
      payment_method: "cash",
      payment_status: "pending",
    });
    expect(res.number).toBeGreaterThanOrEqual(1000);
    expect(res.tracking_token).toMatch(/^[0-9a-f]{32}$/);
    expect(res.status).toBe("new");
    expect(res.total_cents).toBe(2700);

    const o = await api.getOrderByToken(res.tracking_token);
    expect(o).not.toBeNull();
    expect(o!.number).toBe(res.number);
    expect(o!.status).toBe("new");
    expect(o!.type).toBe("delivery");
    expect(o!.payment_method).toBe("cash");
    expect(o!.payment_status).toBe("pending");
    expect(o!.items.map((i) => [i.name, i.qty])).toEqual([["Tonkotsu Ramen", 2]]);
    expect(o!.total_cents).toBe(2700);
    expect(o!.address?.floor_apt).toBe("3. OG");
    expect(o!.comment_flags).toEqual(["leave_at_door", "no_wasabi"]);
    expect(o!.events.map((e) => e.type)).toContain("created");
    expect(new Date(o!.eta!).getTime()).toBe(new Date(scheduled).getTime());
    expect((o as unknown as Record<string, unknown>).contact_phone).toBeUndefined();

    expect(await api.getOrderByToken("0000000000000000000000000000dead")).toBeNull();
  });
});
