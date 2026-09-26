import { readFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, freshPhone, openAllDay, ramenOrder, rpc, signIn } from "./helpers";

beforeAll(openAllDay);

/** Places an order, then back-dates the customer and the order so they look `months` silent. */
async function silentCustomer(monthsAgo: number, overrides: Record<string, unknown> = {}) {
  const phone = freshPhone();
  const { data, error } = await rpc(anon(), "place_order", {
    payload: ramenOrder({ contact: { name: "Old Guest", phone, email: "old@example.com" }, courier_comment: "2nd floor, ring twice", ...overrides }),
  });
  if (error) throw new Error(error.message + " " + error.details);
  const a = admin();
  const { data: c } = await a.from("customers").select("id").eq("phone", phone).single();
  const at = new Date(Date.now() - monthsAgo * 30.5 * 86400_000).toISOString();
  await a.from("customers").update({ created_at: at, kitchen_note: "Nussallergie", birthday: "1990-05-05", consent_email: { granted_at: at, source: "checkout" } }).eq("id", c!.id);
  await a.from("orders").update({ created_at: at }).eq("id", data.order_id);
  return { customer_id: c!.id as string, order_id: data.order_id as string, phone, total: data.total_cents as number };
}

describe("anonymise_silent_customers", () => {
  it("scrubs PII of customers silent for 24 months, keeps the orders (GoBD)", async () => {
    const old = await silentCustomer(30);
    const recent = await silentCustomer(3);
    const a = admin();

    const { data: n, error } = await a.rpc("anonymise_silent_customers", { months: 24 });
    expect(error).toBeNull();
    expect(n).toBeGreaterThanOrEqual(1);

    const { data: c } = await a.from("customers").select("*").eq("id", old.customer_id).single();
    expect(c).toMatchObject({
      name: "Anonymised", phone: `anon-${old.customer_id}`, email: null,
      kitchen_note: null, birthday: null, consent_email: null, consent_push: null, consent_phone: null,
    });
    expect(c!.anonymised_at).toBeTruthy();
    expect((await a.from("customer_addresses").select("id").eq("customer_id", old.customer_id)).data).toEqual([]);

    // order kept with totals and number, personal snapshot gone
    const { data: o } = await a.from("orders").select("*").eq("id", old.order_id).single();
    expect(o!.total_cents).toBe(old.total);
    expect(o!.number).toBeGreaterThanOrEqual(1000);
    expect(o).toMatchObject({ contact_name: "Anonymised", contact_phone: `anon-${old.customer_id}`, courier_comment: null, allergy_note: null });
    expect(o!.address).toEqual({ postal_code: "10243", city: "Berlin" }); // street dropped, zone data kept
    expect((await a.from("order_items").select("id").eq("order_id", old.order_id)).data!.length).toBe(1);
    const { data: ce } = await a.from("customer_events").select("type, payload").eq("customer_id", old.customer_id);
    expect(ce!.map((e) => e.type)).toContain("anonymised");

    // recent customer untouched, and a second run does not touch the already anonymised one
    const { data: r } = await a.from("customers").select("name, anonymised_at").eq("id", recent.customer_id).single();
    expect(r).toMatchObject({ name: "Old Guest", anonymised_at: null });
    const before = (await a.from("customer_events").select("id").eq("customer_id", old.customer_id)).data!.length;
    await a.rpc("anonymise_silent_customers", { months: 24 });
    expect((await a.from("customer_events").select("id").eq("customer_id", old.customer_id)).data!.length).toBe(before);
  });

  it("months is configurable and only owner / service role may run it", async () => {
    const c = await silentCustomer(8);
    const a = admin();
    expect((await a.rpc("anonymise_silent_customers", { months: 24 })).data).toBeDefined();
    expect((await a.from("customers").select("anonymised_at").eq("id", c.customer_id).single()).data!.anonymised_at).toBeNull();
    const { data: n } = await a.rpc("anonymise_silent_customers", { months: 6 });
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await a.from("customers").select("name").eq("id", c.customer_id).single()).data!.name).toBe("Anonymised");

    const [owner, operator] = await Promise.all([signIn("owner"), signIn("operator")]);
    expect((await owner.rpc("anonymise_silent_customers", { months: 24 })).error).toBeNull();
    expect((await operator.rpc("anonymise_silent_customers", { months: 24 })).error!.message).toBe("forbidden_for_role");
    expect((await anon().rpc("anonymise_silent_customers", { months: 24 })).error).not.toBeNull();
  });

  it("the seed never runs the job", async () => {
    const seed = await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8");
    expect(seed).not.toMatch(/anonymise_silent_customers/);
  });
});
