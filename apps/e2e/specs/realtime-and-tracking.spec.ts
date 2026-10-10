import { expect, test } from "../fixtures";
import { anon, freshPhone, ITEM, openAllDayAndResume } from "../helpers/db";

test.beforeAll(openAllDayAndResume);

test("the DB really does broadcast on order:<token> — independent re-check of S2-03's own test", async ({ db }) => {
  // Re-verifying apps/backend/tests/guest_realtime.test.ts's own claim from outside the backend's test
  // harness: a plain anon client, subscribing exactly as api-contracts §5.6 documents for the web app.
  const { data: o, error } = await anon().rpc("place_order", {
    payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Realtime Probe", phone: freshPhone() }, payment_method: "cash", payment_status: "pending" },
  });
  if (error) throw new Error(error.message);

  const client = anon();
  const received: Record<string, unknown>[] = [];
  const channel = client.channel(`order:${o.tracking_token}`, { config: { private: true } });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("subscribe timed out")), 15_000);
    channel.on("broadcast", { event: "order_updated" }, ({ payload }) => received.push(payload)).subscribe((status) => {
      if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timer); reject(new Error(status)); }
    });
  });

  try {
    // S2-03's own fix to apps/backend/tests/guest_realtime.test.ts (task 8, determinism): `SUBSCRIBED`
    // does not prove the Realtime server's fan-out for THIS topic is ready yet, so a single update right
    // after subscribing is a real race, not a flaky test. Their fix — nudge until a message is actually
    // observed, only then perform the change under test — reproduced itself live in this boot: the naive
    // version below (subscribe → one change → wait) genuinely missed the broadcast on this suite's very
    // first CI run (memory/log.md's S6-01 entry has the number). Mirroring their pattern here instead of
    // a longer fixed wait.
    const warmupDeadline = Date.now() + 20_000;
    let nudge = 0;
    while (received.length === 0 && Date.now() < warmupDeadline) {
      nudge += 1;
      await db.from("orders").update({ promised_minutes: 30 + (nudge % 2) }).eq("id", o.order_id);
      await new Promise((r) => setTimeout(r, 400));
    }
    expect(received.length, "realtime never delivered a single message on order:<token> within the warm-up window").toBeGreaterThan(0);

    received.length = 0;
    await db.rpc("set_order_status", { order_id: o.order_id, new_status: "accepted" });
    await expect.poll(() => received.some((m) => m.status === "accepted"), { timeout: 15_000, message: "no order_updated broadcast received for the accepted transition" }).toBe(true);
  } finally {
    await client.removeChannel(channel);
  }
});

test("apps/web never subscribes to that broadcast — the guest tracking page is poll-only today", async ({ webPage, db }) => {
  // Seam check, task 2 ("realtime actually delivering ... without a reload"). TrackingClient.tsx
  // (apps/web/components/order/TrackingClient.tsx) only sets a 15s setInterval; grepping apps/web for
  // `.channel(` / `realtime` / `order_updated` returns zero hits. If this test starts failing because
  // the update now arrives fast, apps/web has been wired up and this whole test (and the finding) is stale.
  const { data: o, error } = await anon().rpc("place_order", {
    payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Poll Gap Probe", phone: freshPhone() }, payment_method: "cash", payment_status: "pending" },
  });
  if (error) throw new Error(error.message);

  await webPage.goto(`/order/${o.tracking_token}`);
  await expect(webPage.getByText("Order received")).toBeVisible();

  await db.rpc("set_order_status", { order_id: o.order_id, new_status: "accepted" });
  // Give it a window comfortably inside the 15s poll but well above any realtime latency, then assert
  // the page has NOT updated yet — a falsifiable statement of the gap, not just "it eventually works".
  await webPage.waitForTimeout(5_000);
  const stillShowsNew = await webPage.getByText("Order accepted").isVisible().then(() => false).catch(() => true);
  expect(stillShowsNew, "if this is false, the tracking page updated within 5s — realtime is wired after all and this finding is stale").toBe(true);

  // ...and it does catch up once the poll fires.
  await expect(webPage.getByText("Order accepted")).toBeVisible({ timeout: 16_000 });
});

test("tracking page still resolves correctly once the order has reached a final state", async ({ webPage, db }) => {
  const { data: o, error } = await anon().rpc("place_order", {
    payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Final State Probe", phone: freshPhone() }, payment_method: "cash", payment_status: "pending" },
  });
  if (error) throw new Error(error.message);
  await db.rpc("set_order_status", { order_id: o.order_id, new_status: "cancelled", payload: { reason: "e2e cleanup" } });

  await webPage.goto(`/order/${o.tracking_token}`);
  await expect(webPage.getByText("Cancelled")).toBeVisible();
  // the page's own 15s refresh loop stops once FINAL.includes(status) — confirm it doesn't error out
  // by waiting past one poll interval and re-checking the same state, not a stale/blank one.
  await webPage.waitForTimeout(16_000);
  await expect(webPage.getByText("Cancelled")).toBeVisible();
});
