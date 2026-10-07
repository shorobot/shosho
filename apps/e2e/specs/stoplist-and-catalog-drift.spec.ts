import { expect, test } from "../fixtures";
import { anon, freshPhone, ITEM, openAllDayAndResume } from "../helpers/db";

test.beforeAll(openAllDayAndResume);

test("item stoplisted after it's already in the guest's cart", async ({ webPage, db }) => {
  await webPage.goto("/");
  await webPage.getByRole("button", { name: "OK" }).click();
  await webPage.getByRole("button", { name: "Add Tonkotsu Ramen" }).click();

  await db.from("menu_items").update({ stoplist_until: "2999-01-01" }).eq("id", ITEM.ramen);
  try {
    await webPage.goto("/checkout");
    // CartLines.tsx: a line with an "unavailable" problem shows this exact copy and a Remove action.
    await expect(webPage.getByText("Unavailable.")).toBeVisible({ timeout: 10_000 });
    await expect(webPage.getByRole("complementary", { name: "Order summary" }).getByRole("button", { name: /Place order/ })).toBeDisabled();
  } finally {
    await db.from("menu_items").update({ stoplist_until: null }).eq("id", ITEM.ramen); // seeded item — must be restored for every other spec file
  }
});

test("an item deleted after being quoted is rejected, not silently charged", async ({ db }) => {
  // A disposable item, never on the real menu, so this never touches seeded/shared data.
  const { data: category } = await db.from("menu_categories").select("id").eq("slug", "rolls").single();
  const { data: ghost, error: insErr } = await db
    .from("menu_items")
    .insert({ sku: `E2E-${Date.now()}`, category_id: category!.id, name_de: "E2E Geist", name_en: "E2E Ghost", base_price_cents: 999, available: true })
    .select("id")
    .single();
  if (insErr) throw insErr;

  const payload = { type: "pickup", items: [{ item_id: ghost!.id, qty: 1 }] };
  const quoteBefore = await anon().rpc("quote_order", { payload });
  expect(quoteBefore.data?.problems ?? [], "the item exists and is available — a fresh quote must be clean").toEqual([]);

  await db.from("menu_items").delete().eq("id", ghost!.id);

  const quoteAfter = await anon().rpc("quote_order", { payload });
  expect(quoteAfter.data?.problems?.some((p: { code: string; item_id?: string }) => p.code === "unavailable" && p.item_id === ghost!.id), `quote_order must flag a deleted item as unavailable, not silently drop or price it: ${JSON.stringify(quoteAfter.data?.problems)}`).toBe(true);

  const place = await anon().rpc("place_order", {
    payload: { ...payload, contact: { name: "E2E Ghost Buyer", phone: freshPhone() }, payment_method: "cash", payment_status: "pending" },
  });
  expect(place.error?.message, "place_order must refuse the same way, not create an order for a line item that no longer exists").toBe("order_rejected");
});

test("option snapshot on an already-placed order survives a later price change on that option", async ({ db }) => {
  // RL-014 (Philadelphia Deluxe) requires Size + Soy sauce and offers the optional "Wasabi & Ingwer"
  // group — placing with Extra Wasabi (+0.50€) at today's price, then changing that price, and
  // confirming the order's own line still shows the price it was bought at (api-contracts §1.4:
  // order_items.options is a snapshot `[{group, option, price_cents}]`, not a live join).
  const EXTRA_WASABI = "41000000-0000-4000-8000-000000000201";
  const SIZE_8 = "41000000-0000-4000-8000-000000000101";
  const SOY_CLASSIC = "41000000-0000-4000-8000-000000000301";
  const PHILADELPHIA = "30000000-0000-4000-8000-000000000001";

  const payload = {
    type: "pickup",
    items: [{ item_id: PHILADELPHIA, qty: 1, option_ids: [SIZE_8, SOY_CLASSIC, EXTRA_WASABI] }],
    contact: { name: "E2E Snapshot Guest", phone: freshPhone() },
    payment_method: "cash",
    payment_status: "pending",
  };
  const { data: placed, error } = await anon().rpc("place_order", { payload });
  if (error) throw new Error(`${error.message} ${error.details ?? ""}`);

  const { data: before } = await db.from("order_items").select("options").eq("order_id", placed.order_id).single();
  const wasabiBefore = (before!.options as { option_id: string; price_cents: number }[]).find((o) => o.option_id === EXTRA_WASABI);
  expect(wasabiBefore?.price_cents, "seeded Extra Wasabi price").toBe(50);

  await db.from("options").update({ price_cents: 150 }).eq("id", EXTRA_WASABI);
  try {
    const { data: after } = await db.from("order_items").select("options").eq("order_id", placed.order_id).single();
    const wasabiAfter = (after!.options as { option_id: string; price_cents: number }[]).find((o) => o.option_id === EXTRA_WASABI);
    expect(wasabiAfter?.price_cents, "the already-placed order's snapshot must not move when the catalogue price changes later").toBe(50);
  } finally {
    await db.from("options").update({ price_cents: 50 }).eq("id", EXTRA_WASABI); // seeded row — restore
  }
});
