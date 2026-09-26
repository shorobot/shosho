import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, freshPhone, openAllDay, ramenOrder, rpc, signIn, STAFF, type Db } from "./helpers";

beforeAll(openAllDay);

async function order(overrides: Record<string, unknown> = {}) {
  const { data, error } = await rpc(anon(), "place_order", { payload: ramenOrder(overrides) });
  if (error) throw new Error(error.message + " " + error.details);
  return data as { order_id: string; number: number; total_cents: number };
}
const timeline = async (customer_id: string) =>
  (await admin().from("customer_events").select("type, actor_type, actor_id, payload").eq("customer_id", customer_id).order("at")).data!;

describe("customer_events (profile timeline)", () => {
  let operator: Db, owner: Db, kitchen: Db;
  beforeAll(async () => {
    [operator, owner, kitchen] = await Promise.all([signIn("operator"), signIn("owner"), signIn("kitchen")]);
  });

  it("every order writes an `order` event on the customer", async () => {
    const phone = freshPhone();
    const first = await order({ contact: { name: "Timeline Test", phone } });
    const second = await order({ contact: { name: "Timeline Test", phone }, type: "pickup", address: undefined });
    const { data: c } = await admin().from("customers").select("id").eq("phone", phone).single();
    const ev = await timeline(c!.id);
    expect(ev.map((e) => e.type)).toEqual(["order", "order"]);
    expect(ev[0]).toMatchObject({ actor_type: "customer", actor_id: c!.id });
    expect(ev[0].payload).toMatchObject({ order_id: first.order_id, number: first.number, type: "delivery", channel: "website", total_cents: first.total_cents });
    expect(ev[1].payload).toMatchObject({ order_id: second.order_id, type: "pickup" });
  });

  it("set_order_status payload.note lands on the order and the customer timeline", async () => {
    const phone = freshPhone();
    const o = await order({ contact: { name: "Note Test", phone } });
    await rpc(operator, "set_order_status", { order_id: o.order_id, new_status: "accepted", payload: { note: "Called the guest, later delivery" } });
    const { data: c } = await admin().from("customers").select("id").eq("phone", phone).single();
    const ev = await timeline(c!.id);
    expect(ev.map((e) => e.type)).toEqual(["order", "note"]);
    expect(ev[1]).toMatchObject({ actor_type: "staff", actor_id: STAFF.operator.id });
    expect(ev[1].payload).toMatchObject({ text: "Called the guest, later delivery", order_id: o.order_id, number: o.number, status: "accepted" });
    const { data: oev } = await admin().from("order_events").select("type").eq("order_id", o.order_id).eq("type", "note");
    expect(oev).toHaveLength(1);
  });

  it("consent changes are recorded per channel with granted / source", async () => {
    const phone = freshPhone();
    await order({ contact: { name: "Consent Test", phone } });
    const { data: c } = await admin().from("customers").select("id").eq("phone", phone).single();

    await operator.from("customers").update({
      consent_email: { granted_at: "2026-09-21T10:00:00Z", source: "checkout" },
      consent_push: { granted_at: "2026-09-21T10:00:00Z", source: "app" },
    }).eq("id", c!.id);
    await operator.from("customers").update({ consent_push: null }).eq("id", c!.id);

    const ev = (await timeline(c!.id)).filter((e) => e.type === "consent_changed");
    expect(ev).toHaveLength(3);
    expect(ev.map((e) => [e.payload.channel, e.payload.granted])).toEqual([["email", true], ["push", true], ["push", false]]);
    expect(ev[0]).toMatchObject({ actor_type: "staff", actor_id: STAFF.operator.id });
    expect(ev[0].payload).toMatchObject({ source: "checkout" });
    expect(ev[2].payload.previous).toMatchObject({ source: "app" });
    // a non-consent update writes nothing
    await operator.from("customers").update({ tags: ["VIP"] }).eq("id", c!.id);
    expect((await timeline(c!.id)).filter((e) => e.type === "consent_changed")).toHaveLength(3);
  });

  it("add_customer_event: staff only, validated types, complaint / compensation / note", async () => {
    const phone = freshPhone();
    const o = await order({ contact: { name: "Complaint Test", phone } });
    const { data: c } = await admin().from("customers").select("id").eq("phone", phone).single();

    const { data: complaint, error } = await rpc(operator, "add_customer_event", {
      customer_id: c!.id, type: "complaint", payload: { text: "Sushi arrived warm", order_id: o.order_id },
    });
    expect(error).toBeNull();
    expect(complaint).toMatchObject({ type: "complaint", actor_type: "staff", actor_id: STAFF.operator.id });

    const { error: comp } = await rpc(owner, "add_customer_event", {
      customer_id: c!.id, type: "compensation", payload: { kind: "voucher", amount_cents: 500, order_id: o.order_id },
    });
    expect(comp).toBeNull();

    expect((await rpc(operator, "add_customer_event", { customer_id: c!.id, type: "order", payload: {} })).error!.message).toBe("invalid_input");
    expect((await rpc(operator, "add_customer_event", { customer_id: c!.id, type: "note", payload: {} })).error!.message).toBe("invalid_input");
    expect((await rpc(operator, "add_customer_event", { customer_id: "00000000-0000-4000-8000-000000000000", type: "note", payload: { text: "x" } })).error!.message).toBe("customer_not_found");
    expect((await rpc(kitchen, "add_customer_event", { customer_id: c!.id, type: "note", payload: { text: "x" } })).error!.message).toBe("forbidden_for_role");
    expect((await rpc(anon(), "add_customer_event", { customer_id: c!.id, type: "note", payload: { text: "x" } })).error).not.toBeNull();

    const ev = await timeline(c!.id);
    expect(ev.map((e) => e.type)).toEqual(["order", "complaint", "compensation"]);
    // anon sees nothing, staff sees the timeline
    expect((await anon().from("customer_events").select("id").limit(1)).data).toEqual([]);
    expect((await operator.from("customer_events").select("id").eq("customer_id", c!.id)).data!.length).toBe(3);
    expect((await kitchen.from("customer_events").select("id").limit(1)).data).toEqual([]);
  });
});
