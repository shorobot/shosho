import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, ramenOrder, rpc, signIn, STAFF, type Db } from "./helpers";

beforeAll(openAllDay);

async function newOrder(payload = ramenOrder()) {
  const { data, error } = await rpc(anon(), "place_order", { payload });
  if (error) throw new Error(error.message + " " + error.details);
  return data.order_id as string;
}

async function setStatus(c: Db, order_id: string, new_status: string, payload: Record<string, unknown> = {}) {
  return rpc(c, "set_order_status", { order_id, new_status, payload });
}

describe("set_order_status", () => {
  let operator: Db, kitchen: Db, driver: Db, owner: Db;
  beforeAll(async () => {
    [operator, kitchen, driver, owner] = await Promise.all([
      signIn("operator"), signIn("kitchen"), signIn("driver"), signIn("owner"),
    ]);
  });

  it("full delivery lifecycle with role gates and timeline", async () => {
    const id = await newOrder();

    // illegal transition
    const { error: ill } = await setStatus(operator, id, "preparing");
    expect(ill!.message).toBe("illegal_transition");

    // kitchen may not accept
    const { error: kAcc } = await setStatus(kitchen, id, "accepted");
    expect(kAcc!.message).toBe("forbidden_for_role");

    const { data: acc, error: e1 } = await setStatus(operator, id, "accepted");
    expect(e1).toBeNull();
    expect(acc.status).toBe("accepted");
    expect(acc.accepted_by).toBe(STAFF.operator.id);
    expect(acc.accepted_at).toBeTruthy();

    const { data: prep, error: e2 } = await setStatus(kitchen, id, "preparing");
    expect(e2).toBeNull();
    expect(prep.promised_minutes).toBe(60); // zone B, no rush

    const { data: ready, error: e3 } = await setStatus(kitchen, id, "ready");
    expect(e3).toBeNull();
    expect(ready.ready_at).toBeTruthy();

    // pickup-only status on a delivery order
    const { error: pu } = await setStatus(operator, id, "picked_up");
    expect(pu!.message).toBe("illegal_transition");

    // driver required for out_for_delivery
    const { error: nd } = await setStatus(operator, id, "out_for_delivery");
    expect(nd!.message).toBe("driver_required");
    const { data: out, error: e4 } = await setStatus(operator, id, "out_for_delivery", { driver_id: STAFF.driver.id });
    expect(e4).toBeNull();
    expect(out.driver_id).toBe(STAFF.driver.id);

    // kitchen cannot set delivered
    const { error: kDel } = await setStatus(kitchen, id, "delivered");
    expect(kDel!.message).toBe("forbidden_for_role");

    // driver sees own order, delivers, payment captured (v1 stub)
    const { data: mine } = await driver.from("orders").select("id").eq("id", id);
    expect(mine).toHaveLength(1);
    const { data: del, error: e5 } = await setStatus(driver, id, "delivered");
    expect(e5).toBeNull();
    expect(del.status).toBe("delivered");
    expect(del.payment_status).toBe("paid");
    expect(del.completed_at).toBeTruthy();

    // refund: owner/operator only, from paid & completed
    const { error: dr } = await setStatus(driver, id, "refunded");
    expect(dr!.message).toBe("forbidden_for_role");
    const { data: ref, error: e6 } = await setStatus(owner, id, "refunded", { note: "Kunde unzufrieden" });
    expect(e6).toBeNull();
    expect(ref.payment_status).toBe("refunded");

    const { data: ev } = await admin().from("order_events").select("type, actor_type, actor_id").eq("order_id", id).order("at");
    expect(ev!.map((e) => e.type)).toEqual([
      "created", "accepted", "preparing", "ready", "handed_to_driver", "delivered", "refunded", "note",
    ]);
    expect(ev![1]).toMatchObject({ actor_type: "staff", actor_id: STAFF.operator.id });
    expect(ev![5]).toMatchObject({ actor_type: "staff", actor_id: STAFF.driver.id });
  });

  it("pickup lifecycle + cancel", async () => {
    const id = await newOrder(ramenOrder({ type: "pickup", address: undefined }));
    await setStatus(operator, id, "accepted");
    await setStatus(operator, id, "preparing");
    await setStatus(operator, id, "ready");
    const { error: ofd } = await setStatus(operator, id, "out_for_delivery", { driver_id: STAFF.driver.id });
    expect(ofd!.message).toBe("illegal_transition");
    const { data: pu } = await setStatus(operator, id, "picked_up");
    expect(pu.status).toBe("picked_up");

    const id2 = await newOrder();
    const { data: c } = await setStatus(operator, id2, "cancelled", { cancel_reason: "customer_request" });
    expect(c.status).toBe("cancelled");
    expect(c.cancel_reason).toBe("customer_request");
    const { error: again } = await setStatus(operator, id2, "accepted");
    expect(again!.message).toBe("illegal_transition");
  });

  it("anon and non-staff cannot change status", async () => {
    const id = await newOrder();
    const { error } = await setStatus(anon(), id, "accepted");
    expect(error).not.toBeNull(); // no execute grant for anon → PostgREST 401/404
  });
});
