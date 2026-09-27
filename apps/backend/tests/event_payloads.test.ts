import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, ramenOrder, rpc, signIn, STAFF, type Db } from "./helpers";

beforeAll(openAllDay);

/** §1.4 / §6.9 row 3 — the payload each order_events type must carry. */
async function newOrder(payload = ramenOrder()) {
  const { data, error } = await rpc(anon(), "place_order", { payload });
  if (error) throw new Error(`${error.message} ${error.details}`);
  return data.order_id as string;
}

const setStatus = (c: Db, order_id: string, new_status: string, payload: Record<string, unknown> = {}) =>
  rpc(c, "set_order_status", { order_id, new_status, payload });

async function events(order_id: string) {
  const { data } = await admin().from("order_events").select("type, payload, actor_type").eq("order_id", order_id).order("at");
  return data as { type: string; payload: Record<string, unknown>; actor_type: string }[];
}
const firstOf = (ev: Awaited<ReturnType<typeof events>>, type: string) => ev.find((e) => e.type === type)!;

describe("order_events payloads per type", () => {
  let operator: Db, kitchen: Db;
  beforeAll(async () => { [operator, kitchen] = await Promise.all([signIn("operator"), signIn("kitchen")]); });

  it("created {channel} · accepted {promised_minutes} · preparing {promised_minutes, station} · ready {}", async () => {
    const id = await newOrder();
    await setStatus(operator, id, "accepted");
    await setStatus(kitchen, id, "preparing", { station: "sushi-bar" });
    await setStatus(kitchen, id, "ready");
    const ev = await events(id);

    expect(firstOf(ev, "created").payload).toMatchObject({ channel: "website" });
    expect(firstOf(ev, "accepted").payload.promised_minutes).toEqual(expect.any(Number));
    expect(firstOf(ev, "preparing").payload).toMatchObject({ station: "sushi-bar" });
    expect(firstOf(ev, "preparing").payload.promised_minutes).toEqual(expect.any(Number));
    // ready carries no documented key of its own; from/to are the extras every status event has
    expect(Object.keys(firstOf(ev, "ready").payload).sort()).toEqual(["from", "to"]);
  });

  it("handed_to_driver {driver_id, driver_name}", async () => {
    const id = await newOrder();
    await setStatus(operator, id, "accepted");
    await setStatus(kitchen, id, "preparing");
    await setStatus(kitchen, id, "ready");
    await setStatus(operator, id, "out_for_delivery", { driver_id: STAFF.driver.id });
    expect(firstOf(await events(id), "handed_to_driver").payload).toMatchObject({
      driver_id: STAFF.driver.id,
      driver_name: "Jonas M.",
    });
  });

  it("delivered {cash_received} for a cash order", async () => {
    const id = await newOrder(ramenOrder({ payment_method: "cash" }));
    await setStatus(operator, id, "accepted");
    await setStatus(kitchen, id, "preparing");
    await setStatus(kitchen, id, "ready");
    await setStatus(operator, id, "out_for_delivery", { driver_id: STAFF.driver.id });
    await setStatus(operator, id, "delivered", { cash_received: true });
    expect(firstOf(await events(id), "delivered").payload).toMatchObject({ cash_received: true });
  });

  it("payment_authorized {payment_ref, amount_cents} (client-reported authorization)", async () => {
    const id = await newOrder(ramenOrder({ payment_status: "authorized", payment_ref: "Visa ···4417" }));
    const pa = firstOf(await events(id), "payment_authorized").payload;
    expect(pa).toMatchObject({ payment_ref: "Visa ···4417", payment_method: "card" });
    expect(pa.amount_cents).toEqual(expect.any(Number));
    // no provider on the v1 client-reported path — stripped rather than written as null
    expect(pa.provider).toBeUndefined();
  });

  it("refunded {amount_cents}", async () => {
    const id = await newOrder();
    await setStatus(operator, id, "accepted");
    await setStatus(kitchen, id, "preparing");
    await setStatus(kitchen, id, "ready");
    await setStatus(operator, id, "out_for_delivery", { driver_id: STAFF.driver.id });
    const { data: delivered } = await setStatus(operator, id, "delivered");
    expect(delivered.payment_status).toBe("paid");
    await setStatus(operator, id, "refunded", { amount_cents: 500 });
    expect(firstOf(await events(id), "refunded").payload).toMatchObject({ amount_cents: 500 });
  });

  it("cancelled {reason} — `reason` canonical, `cancel_reason` still accepted (§6.9 row 4)", async () => {
    for (const [key, value] of [["reason", "out_of_stock"], ["cancel_reason", "customer_request"]] as const) {
      const id = await newOrder();
      const { data: row, error } = await setStatus(operator, id, "cancelled", { [key]: value });
      expect(error, key).toBeNull();
      expect(row.cancel_reason, key).toBe(value);              // the column stays `cancel_reason`
      const payload = firstOf(await events(id), "cancelled").payload;
      expect(payload.reason, key).toBe(value);                 // canonical
      expect(payload.cancel_reason, key).toBe(value);          // legacy mirror, one release
    }
  });

  it("`reason` wins when a client sends both", async () => {
    const id = await newOrder();
    const { data: row } = await setStatus(operator, id, "cancelled", { reason: "canonical", cancel_reason: "legacy" });
    expect(row.cancel_reason).toBe("canonical");
  });

  it("note {text, code?}", async () => {
    const id = await newOrder();
    await setStatus(operator, id, "accepted", { note: "called the guest" });
    expect(firstOf(await events(id), "note").payload).toMatchObject({ text: "called the guest" });

    // the system writes a code where it has one (cash not received)
    const cash = await newOrder(ramenOrder({ payment_method: "cash" }));
    await setStatus(operator, cash, "accepted");
    await setStatus(kitchen, cash, "preparing");
    await setStatus(kitchen, cash, "ready");
    await setStatus(operator, cash, "out_for_delivery", { driver_id: STAFF.driver.id });
    await setStatus(operator, cash, "delivered", { cash_received: false });
    expect(firstOf(await events(cash), "note").payload).toMatchObject({ code: "cash_not_received" });
  });

  it("the RPC extras do not leak into the next status change in the same session", async () => {
    const id = await newOrder();
    await setStatus(operator, id, "accepted");
    await setStatus(kitchen, id, "preparing", { station: "sushi-bar" });
    await setStatus(kitchen, id, "ready");
    const ev = await events(id);
    expect(firstOf(ev, "ready").payload.station).toBeUndefined();
  });
});
