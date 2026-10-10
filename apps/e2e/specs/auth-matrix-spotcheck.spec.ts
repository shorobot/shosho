import { expect, test } from "../fixtures";
import { anon, freshPhone, ITEM, openAllDayAndResume, signInAs } from "../helpers/db";

// Task 4: spot-check 2 rows of docs/security.md's authorisation matrix from OUTSIDE
// apps/backend/tests/security.test.ts's own harness — a real anon key, real seed JWTs, nothing borrowed
// from the backend suite's helpers or fixtures.
test.beforeAll(openAllDayAndResume);

test("anon cannot call set_order_status directly (migration 18 revoked the EXECUTE grant)", async () => {
  const { data: o, error: placeError } = await anon().rpc("place_order", {
    payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Auth Probe", phone: freshPhone() }, payment_method: "cash", payment_status: "pending" },
  });
  if (placeError) throw new Error(placeError.message);

  const { error } = await anon().rpc("set_order_status", { order_id: o.order_id, new_status: "accepted" });
  expect(error, "anon has no EXECUTE on set_order_status at all — this must fail, not silently no-op").toBeTruthy();
  expect(error!.message).not.toBe(""); // PostgREST's "permission denied for function" / 42501, not a success
});

test("kitchen role cannot edit order positions (update_order_items is operator/owner only)", async () => {
  const kitchen = await signInAs("kitchen");
  const { data: o, error: placeError } = await anon().rpc("place_order", {
    payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Kitchen Probe", phone: freshPhone() }, payment_method: "cash", payment_status: "pending" },
  });
  if (placeError) throw new Error(placeError.message);

  const { error } = await kitchen.rpc("update_order_items", { order_id: o.order_id, items: [{ item_id: ITEM.ramen, qty: 2 }] });
  expect(error?.message, "api-contracts §6.8: update_order_items is operator/owner only").toBe("forbidden_for_role");
});
