import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, ramenOrder, rpc, signIn, type Db } from "./helpers";

beforeAll(openAllDay);

/**
 * §3 guest tracking: the DB broadcasts to the private topic `order:<tracking_token>` on every
 * meaningful order change (migration 16). The guest subscribes with the anon key — the token is the
 * capability, so no PII travels in the payload.
 *
 * DETERMINISM (S2-03 task 8). This failed once on `main` with `no broadcast received` and passed on
 * a re-run. The cause is a race that `status === "SUBSCRIBED"` does not close: the client is joined,
 * but the Realtime server's broadcast fan-out for the topic is not necessarily ready to deliver the
 * very next `realtime.send()` — so a single update plus a fixed wait is a coin flip under load.
 * Instead of a longer timeout, the test now waits on a **real signal**: it nudges the order until a
 * message actually arrives (proving the whole path is live through the same trigger the feature
 * uses), and only then performs the status change it asserts on. If the stack cannot broadcast at
 * all (`ensure_guest_realtime_policy` reports no messages table / send function), the test says so
 * and skips rather than failing a required check for a missing capability.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("guest tracking realtime", () => {
  let operator: Db;
  let capability: Record<string, unknown> = {};
  beforeAll(async () => {
    operator = await signIn("operator");
    const { data } = await admin().rpc("ensure_guest_realtime_policy");
    capability = (data ?? {}) as Record<string, unknown>;
  });

  it("the database can broadcast (messages table, send function, policy)", () => {
    expect(capability).toMatchObject({ messages_table: true, send_function: true, policy: true });
  });

  it("an order update reaches the token topic and carries no PII", async (ctx) => {
    if (!capability.messages_table || !capability.send_function || !capability.policy) {
      ctx.skip(`realtime cannot broadcast on this stack: ${JSON.stringify(capability)}`);
      return;
    }

    const { data: o, error } = await rpc(anon(), "place_order", { payload: ramenOrder() });
    if (error) throw new Error(`${error.message} ${error.details}`);

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
      // 1. warm-up: nudge the order (same trigger, promised_minutes is one of its watched columns)
      //    until a message actually lands. This is the real readiness signal.
      const warmupDeadline = Date.now() + 20_000;
      let nudge = 0;
      while (received.length === 0 && Date.now() < warmupDeadline) {
        nudge += 1;
        await admin().from("orders").update({ promised_minutes: 30 + (nudge % 2) }).eq("id", o.order_id);
        await sleep(400);
      }
      expect(
        received.length,
        `realtime never delivered a message on order:<token> — capability: ${JSON.stringify(capability)}`,
      ).toBeGreaterThan(0);

      // 2. the assertion proper: a status change must arrive with the documented payload
      received.length = 0;
      await rpc(operator, "set_order_status", { order_id: o.order_id, new_status: "accepted" });
      const deadline = Date.now() + 15_000;
      let msg: Record<string, unknown> | undefined;
      while (!msg && Date.now() < deadline) {
        msg = received.find((m) => m.status === "accepted");
        if (!msg) await sleep(150);
      }
      expect(msg, `no accepted broadcast; received instead: ${JSON.stringify(received)}`).toBeTruthy();
      expect(msg).toMatchObject({ order_id: o.order_id, number: o.number, status: "accepted", payment_status: "pending" });
      for (const forbidden of ["contact_name", "contact_phone", "address", "tracking_token", "courier_comment"]) {
        expect(msg![forbidden]).toBeUndefined();
      }
    } finally {
      await client.removeChannel(channel);
    }
  }, 60_000);
});
