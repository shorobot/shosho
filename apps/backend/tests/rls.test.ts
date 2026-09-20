import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, ramenOrder, rpc, signIn } from "./helpers";

beforeAll(openAllDay);

describe("RLS", () => {
  it("anon reads only on-sale menu, active categories/zones, public settings", async () => {
    const a = anon();
    const { data: items, error } = await a.from("menu_items").select("sku");
    expect(error).toBeNull();
    const skus = items!.map((i) => i.sku);
    expect(skus).toContain("RL-014");
    expect(skus).not.toContain("MN-004"); // Ebi Tempura stoplisted today
    const { data: onSale } = await a.from("menu_items_on_sale").select("sku");
    expect(onSale!.length).toBe(items!.length);

    const { data: cats } = await a.from("menu_categories").select("slug, name_ja");
    expect(cats!.length).toBe(10);
    const { data: zones } = await a.from("delivery_zones").select("code");
    expect(zones!.map((z) => z.code).sort()).toEqual(["A", "B", "C"]);

    const { data: settings } = await a.from("settings").select("key");
    expect(settings!.map((s) => s.key).sort()).toEqual(
      ["business", "kitchen.status", "opening_hours", "payments.enabled", "site"],
    );
  });

  it("anon cannot read orders / customers / staff / promo codes (and cannot write)", async () => {
    await rpc(anon(), "place_order", { payload: ramenOrder() });
    const a = anon();
    for (const t of ["orders", "order_items", "order_events", "customers", "customer_addresses", "staff", "promo_codes"] as const) {
      const { data, error } = await a.from(t).select("*").limit(1);
      expect(error, t).toBeNull();
      expect(data, t).toEqual([]);
    }
    const { error: ins } = await a.from("orders").insert({ type: "pickup", payment_method: "cash", contact_name: "x", contact_phone: "+491" } as any);
    expect(ins).not.toBeNull();
    const { error: upd } = await a.from("menu_items").update({ base_price_cents: 1 }).eq("sku", "RL-014");
    // RLS: update is silently a no-op for anon (0 rows) or an error — never a change
    const { data: price } = await admin().from("menu_items").select("base_price_cents").eq("sku", "RL-014").single();
    expect(price!.base_price_cents).toBe(1490);
    void upd;
  });

  it("role matrix: operator all, kitchen read-only orders, driver only own, owner settings", async () => {
    const [operator, kitchen, driver, owner] = await Promise.all([
      signIn("operator"), signIn("kitchen"), signIn("driver"), signIn("owner"),
    ]);
    const { data: r } = await rpc(anon(), "place_order", { payload: ramenOrder() });

    const { data: opOrders } = await operator.from("orders").select("id").eq("id", r.order_id);
    expect(opOrders).toHaveLength(1);
    const { data: opCust } = await operator.from("customers").select("id").limit(1);
    expect(opCust!.length).toBeGreaterThan(0);
    const { data: stats } = await operator.from("customer_stats").select("*").limit(1);
    expect(stats!.length).toBeGreaterThan(0);

    const { data: kOrders } = await kitchen.from("orders").select("id").eq("id", r.order_id);
    expect(kOrders).toHaveLength(1);
    const { data: kCust } = await kitchen.from("customers").select("id");
    expect(kCust).toEqual([]);
    const { error: kUpd, data: kUpdData } = await kitchen.from("orders").update({ status: "accepted" }).eq("id", r.order_id).select();
    expect(kUpdData ?? []).toEqual([]);
    void kUpd;

    const { data: dOrders } = await driver.from("orders").select("id").eq("id", r.order_id);
    expect(dOrders).toEqual([]); // not assigned
    const { data: dStaff } = await driver.from("staff").select("id");
    expect(dStaff!.map((s) => s.id)).toEqual(["10000000-0000-4000-8000-000000000004"]); // self only

    const { data: opSettings } = await operator.from("settings").select("key").eq("key", "ops");
    expect(opSettings).toHaveLength(1);
    const { data: opWrite } = await operator.from("settings").update({ value: { x: 1 } }).eq("key", "ops").select();
    expect(opWrite ?? []).toEqual([]); // operator: read only
    const { data: ownWrite, error: ownErr } = await owner.from("settings").update({ value: { hello: true } }).eq("key", "site").select();
    expect(ownErr).toBeNull();
    expect(ownWrite).toHaveLength(1);
    await admin().from("settings").update({ value: { ...(ownWrite![0].value as object), hello: undefined } }).eq("key", "site");

    // helper
    const { data: role } = await rpc(kitchen, "auth_role", {});
    expect(role).toBe("kitchen");
    const { data: anonRole } = await rpc(anon(), "auth_role", {});
    expect(anonRole).toBeNull();
  });
});
