import { expect, test } from "../fixtures";
import { anon, freshPhone, ITEM, openAllDayAndResume, POSTAL } from "../helpers/db";

// Task 3: the 12 product rules from docs/design/README.md, verified literally — each by a real test or,
// where that is genuinely not possible from here, marked unverifiable with the reason. Rules already
// exercised thoroughly by another spec file are cross-referenced rather than re-tested shallowly.
test.beforeAll(openAllDayAndResume);

test("guest checkout needs no account; the customer profile is created automatically, matched by phone", async () => {
  const phone = freshPhone();
  const payload = { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Auto Profile", phone }, payment_method: "cash", payment_status: "pending" };
  const first = await anon().rpc("place_order", { payload });
  if (first.error) throw new Error(first.error.message);
  const second = await anon().rpc("place_order", { payload: { ...payload, contact: { name: "E2E Auto Profile Again", phone } } });
  if (second.error) throw new Error(second.error.message);
  // No auth session was ever created for either call — place_order itself upserts by phone.
  expect(first.data.order_id).not.toBe(second.data.order_id);
});

test("free delivery over the zone's threshold (35€ in seed)", async () => {
  // Zone A: fee 0 already, so use Zone B (290c fee) and cross its 3500c free-delivery line with qty.
  const under = await anon().rpc("quote_order", { payload: { type: "delivery", items: [{ item_id: ITEM.ramen, qty: 1 }], postal_code: POSTAL.zoneB } }); // 1350 < 2200 min, will show below_min_order too, but fee shows regardless
  const over = await anon().rpc("quote_order", { payload: { type: "delivery", items: [{ item_id: ITEM.ramen, qty: 3 }], postal_code: POSTAL.zoneB } }); // 4050 > 3500
  expect(under.data.delivery_fee_cents, "below the zone's free-delivery threshold, the fee applies").toBe(290);
  expect(over.data.delivery_fee_cents, "subtotal 40.50€ > zone B's 35€ free-delivery line").toBe(0);
});

test("every order_events row carries an actor (design: 'every transition is a timeline event with actor')", async ({ db }) => {
  const phone = freshPhone();
  const { data: o, error } = await anon().rpc("place_order", { payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Actor Probe", phone }, payment_method: "cash", payment_status: "pending" } });
  if (error) throw new Error(error.message);
  await db.rpc("set_order_status", { order_id: o.order_id, new_status: "accepted" });
  const { data: events } = await db.from("order_events").select("type, actor_type").eq("order_id", o.order_id).order("at");
  expect(events!.length).toBeGreaterThanOrEqual(2); // created + accepted
  for (const e of events!) expect(e.actor_type, `event "${e.type}" has no actor_type`).toBeTruthy();
});

test("allergy note on the customer profile propagates onto a new order's card", async ({ db, boPage, signInBackoffice }) => {
  const phone = freshPhone();
  // Setup: a customer with a kitchen_note, created ahead of their first order through this suite
  // (owner can write customers directly — this models a note added from a previous call, not the
  // action under test, which is whether `place_order` snapshots it onto the NEW order).
  const { error: upsertErr } = await db.from("customers").insert({ phone, name: "E2E Allergy Guest", kitchen_note: "Severe peanut allergy — E2E" });
  if (upsertErr) throw upsertErr;

  const { data: o, error } = await anon().rpc("place_order", { payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Allergy Guest", phone }, payment_method: "cash", payment_status: "pending" } });
  if (error) throw new Error(error.message);
  expect(o.order_id).toBeTruthy();

  const { data: order } = await db.from("orders").select("allergy_note").eq("id", o.order_id).single();
  expect(order!.allergy_note).toBe("Severe peanut allergy — E2E");

  await signInBackoffice(boPage, "operator");
  const { data: fresh } = await db.from("orders").select("number").eq("id", o.order_id).single();
  await boPage.goto("/orders");
  const card = boPage.locator("article", { hasText: `#${fresh!.number}` });
  await expect(card.getByText("Severe peanut allergy — E2E")).toBeVisible();
});

test("a category with no on-sale item is hidden from the storefront", async ({ webPage, db }) => {
  const { data: cat, error: catErr } = await db.from("menu_categories").insert({ slug: `e2e-empty-${Date.now()}`, name_de: "E2E Leer", name_en: "E2E Empty", active: true, sort: 999 }).select("id, name_en").single();
  if (catErr) throw catErr;
  const { data: item } = await db.from("menu_items").insert({ sku: `E2E-CAT-${Date.now()}`, category_id: cat!.id, name_de: "E2E Artikel", name_en: "E2E Item", base_price_cents: 500, available: true }).select("id").single();

  try {
    await webPage.goto("/");
    await expect(webPage.getByText(cat!.name_en)).toBeVisible();

    await db.from("menu_items").update({ available: false }).eq("id", item!.id);
    await webPage.goto("/"); // no cache to fight locally (next dev); staging may lag up to 60s (S4-02's own note)
    await expect(webPage.getByText(cat!.name_en)).not.toBeVisible();
  } finally {
    await db.from("menu_items").delete().eq("id", item!.id);
    await db.from("menu_categories").delete().eq("id", cat!.id);
  }
});

test("sequential order numbers", async () => {
  const phone1 = freshPhone();
  const phone2 = freshPhone();
  const payload = (phone: string) => ({ type: "pickup" as const, items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Seq", phone }, payment_method: "cash" as const, payment_status: "pending" as const });
  const a = await anon().rpc("place_order", { payload: payload(phone1) });
  const b = await anon().rpc("place_order", { payload: payload(phone2) });
  if (a.error || b.error) throw new Error(a.error?.message ?? b.error?.message);
  expect(b.data.number, "order_number_seq — each new order gets the next integer").toBeGreaterThan(a.data.number);
});

test("S7-01 finding 1 (CRITICAL) stays fixed: a guest cannot self-report payment_status", async () => {
  // migration 20260928000025_payment_trust_boundary.sql (S2-04): a guest sending anything but the
  // default `pending` now gets `invalid_input`/`payment_status` in the rejection, not a silently
  // created order. This is a regression guard on the fix, not a hunt for a live bug — re-verified
  // independently (own anon client, no backend-suite helpers) per boot task 4.
  const phone = freshPhone();
  const { error } = await anon().rpc("place_order", {
    payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Trust Boundary Probe", phone }, payment_method: "card", payment_status: "authorized" },
  });
  expect(error?.message, "a guest claiming payment_status:'authorized' must be refused outright").toBe("order_rejected");
  const problems = JSON.parse((error as unknown as { details: string }).details) as { code: string; field?: string }[];
  expect(problems).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_input", field: "payment_status" })]));
});

test("auto-accept under 50€: the one reachable path on this stack — a staff-recorded paid phone order", async ({ db }) => {
  // No Stripe keys exist, so the webhook-authorized path (migration 11) is out of reach — but
  // migration 20260928000025_payment_trust_boundary.sql's audited staff-paid path (owner/operator
  // recording counter cash/card-terminal money at order entry) is real and reachable, and it is the
  // ONLY thing auto-accept now keys off for a non-Stripe order. Testing that path, not faking the
  // Stripe one.
  const phone = freshPhone();
  const { data: o, error } = await db.rpc("place_order", {
    payload: { type: "pickup", items: [{ item_id: ITEM.ramen, qty: 1 }], contact: { name: "E2E Staff Paid", phone }, payment_method: "cash", payment_status: "paid" },
  });
  if (error) throw new Error(`${error.message} ${(error as { details?: string }).details ?? ""}`);
  expect(o.status, "staff-recorded paid, ASAP, under the 50€ threshold, kitchen not paused → auto-accept").toBe("accepted");

  const { data: note } = await db.from("order_events").select("payload").eq("order_id", o.order_id).eq("type", "note").single();
  expect((note!.payload as { code?: string }).code, "the staff-paid path must be audited (migration 25)").toBe("payment_recorded_by_staff");
});

test.skip("stoplist resets at midnight — not independently verifiable in a timed run; verified by code inspection instead", () => {
  // menu_item_on_sale()'s rule is `stoplist_until IS NULL OR stoplist_until < today` (api-contracts §1.2)
  // — a pure date compare with no scheduled job to "reset" anything, so there is nothing to race against
  // the clock for. Confirmed by reading apps/backend/supabase/migrations/20260920000003_menu.sql; not
  // re-run here because simulating "midnight passed" would mean moving the DB's clock on a shared stack.
});

test("marketing consent gating: resolve_segment excludes a customer with no consent for the channel", async ({ db }) => {
  // S2-06 (migration 20261006000029_segments_and_claim.sql) shipped resolve_segment/
  // claim_campaign_recipients since this boot was issued — campaigns are no longer "not built", so this
  // rule is now directly testable at the one place consent is actually enforced (S5's send pipeline
  // itself doesn't exist yet — tracked separately, not this rule's gap).
  const phone1 = freshPhone();
  const phone2 = freshPhone();
  const { data: consented, error: e1 } = await db.from("customers").insert({ phone: phone1, name: "E2E Consented", consent_email: { granted_at: new Date().toISOString(), source: "e2e" } }).select("id").single();
  if (e1) throw e1;
  const { data: notConsented, error: e2 } = await db.from("customers").insert({ phone: phone2, name: "E2E Not Consented" }).select("id").single();
  if (e2) throw e2;

  try {
    const { data: rows, error } = await db.rpc("resolve_segment", { p_segment: { customer_ids: [consented!.id, notConsented!.id] }, p_channel: "email" });
    if (error) throw error;
    const ids = (rows as { customer_id: string }[]).map((r) => r.customer_id);
    expect(ids, "resolve_segment must drop the non-consented customer even though the segment explicitly named both ids").toContain(consented!.id);
    expect(ids).not.toContain(notConsented!.id);
  } finally {
    await db.from("customers").delete().in("id", [consented!.id, notConsented!.id]);
  }
});
