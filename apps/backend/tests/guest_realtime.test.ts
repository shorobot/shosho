import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, ramenOrder, rpc, signIn, type Db } from "./helpers";

beforeAll(openAllDay);

/**
 * §3 guest tracking: the DB broadcasts to the private topic `order:<tracking_token>` on every
 * meaningful order change (migration 16). The guest subscribes with the anon key — the token is the
 * capability, so no PII travels in the payload.
 */
describe("guest tracking realtime", () => {
  let operator: Db;
  beforeAll(async () => {
    operator = await signIn("operator");
    await admin().rpc("ensure_guest_realtime_policy");
  });

  it("an order update reaches the token topic and carries no PII", async () => {
    const { data: o, error } = await rpc(anon(), "place_order", { payload: ramenOrder() });
    if (error) throw new Error(error.message + " " + error.details);

    const client = anon();
    const received: Record<string, unknown>[] = [];
    const channel = client.channel(`order:${o.tracking_token}`, { config: { private: true } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("subscribe timed out")), 15_000);
      channel
        .on("broadcast", { event: "order_updated" }, ({ payload }) => received.push(payload))
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            clearTimeout(timer);
            reject(new Error(`subscribe: ${status}`));
          }
        });
    });

    try {
      await rpc(operator, "set_order_status", { order_id: o.order_id, new_status: "accepted" });
      const deadline = Date.now() + 10_000;
      while (received.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
      expect(received.length).toBeGreaterThan(0);
      const msg = received[0] as Record<string, unknown>;
      expect(msg).toMatchObject({ order_id: o.order_id, number: o.number, status: "accepted", payment_status: "pending" });
      for (const forbidden of ["contact_name", "contact_phone", "address", "tracking_token", "courier_comment"]) {
        expect(msg[forbidden]).toBeUndefined();
      }
    } finally {
      await client.removeChannel(channel);
    }
  }, 45_000);
});
