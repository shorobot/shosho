import { beforeAll, describe, expect, it } from "vitest";
import {
  admin, anon, asSuperuser, freshPhone, newCustomerAuth, openAllDay, ramenOrder, rpc,
  type CustomerAuth, type Db,
} from "./helpers";

beforeAll(openAllDay);

/**
 * [S2-07] api-contracts §9 — customer accounts, phase A of
 * memory/boots/proposed/ROADMAP-customer-accounts-and-push.md.
 *
 * The two things this file exists to prove, in order of value:
 *   1. The linking rule never hands a new account a stranger's profile — in particular never a
 *      stranger's `kitchen_note`, which `place_order` copies to `orders.allergy_note` on every
 *      order. That makes mis-linking a food-safety defect, not a privacy footnote (finding 5).
 *   2. Guest checkout is unchanged. D-016 makes accounts optional and keeps guest checkout a
 *      first-class path; "unchanged" is a claim that needs evidence, so it is asserted here
 *      rather than asserted in prose.
 *
 * `security.test.ts` carries the third: a customer JWT is refused by every staff surface.
 */

const asAdmin = () => admin();

/** A guest-created customer row, exactly as place_order makes them: no account. */
async function guestCustomer(over: Record<string, unknown> = {}) {
  const phone = freshPhone();
  const { data, error } = await asAdmin()
    .from("customers")
    .insert({ name: "Guest Row", phone, ...over })
    .select()
    .single();
  if (error) throw error;
  return data as { id: string; phone: string; email: string | null };
}

describe("migration 35 — the identity column", () => {
  it("auth_user_id is nullable, unique, indexed and ON DELETE SET NULL", async () => {
    const col = await asSuperuser((c) =>
      c.query(
        `select is_nullable, data_type from information_schema.columns
          where table_schema='public' and table_name='customers' and column_name='auth_user_id'`,
      ),
    );
    expect(col.rows[0]).toMatchObject({ is_nullable: "YES", data_type: "uuid" });

    // the unique constraint IS the index — a second index on the same column would be dead weight
    const idx = await asSuperuser((c) =>
      c.query(
        `select indexdef from pg_indexes
          where tablename='customers' and indexdef like '%auth_user_id%'`,
      ),
    );
    expect(idx.rows.length, "exactly one index covers auth_user_id").toBe(1);
    expect(idx.rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/);

    const fk = await asSuperuser((c) =>
      c.query(
        `select confdeltype from pg_constraint
          where conrelid='public.customers'::regclass and contype='f'
            and conkey = array[(select attnum from pg_attribute
                                 where attrelid='public.customers'::regclass
                                   and attname='auth_user_id')]::smallint[]`,
      ),
    );
    expect(fk.rows[0]?.confdeltype, "n = SET NULL").toBe("n");
  });

  it("deleting the auth user orphans the link instead of deleting the customer", async () => {
    const cust = await guestCustomer();
    const acct = await newCustomerAuth({ phone: cust.phone });
    const { data: linked } = await rpc<any>(acct.client, "link_my_account", {});
    expect(linked.outcome).toBe("linked_by_phone");

    await asAdmin().auth.admin.deleteUser(acct.uid);
    const { data: still } = await asAdmin()
      .from("customers").select("id, auth_user_id").eq("id", cust.id).single();
    expect(still, "the customer row survives").toBeTruthy();
    expect(still!.auth_user_id, "the link is nulled, not cascaded").toBeNull();
  });
});

describe("link_my_account — finding 5 and the email tie-break", () => {
  it("phone match on an eligible row links it, and is idempotent", async () => {
    const cust = await guestCustomer();
    const acct = await newCustomerAuth({ phone: cust.phone });

    const first = await rpc<any>(acct.client, "link_my_account", {});
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ linked: true, outcome: "linked_by_phone", customer_id: cust.id });

    const second = await rpc<any>(acct.client, "link_my_account", {});
    expect(second.data).toMatchObject({ linked: true, outcome: "already_linked", customer_id: cust.id });

    const { data: row } = await asAdmin()
      .from("customers").select("auth_user_id").eq("id", cust.id).single();
    expect(row!.auth_user_id).toBe(acct.uid);
  });

  it("a RECYCLED NUMBER whose profile carries a kitchen_note is refused, and the note is unreachable", async () => {
    // The scenario finding 5 is about: the number now belongs to someone new, and the profile on
    // it holds an allergy note written about whoever had it before.
    const stranger = await guestCustomer({ kitchen_note: "NUT ALLERGY — anaphylaxis" });
    const newOwner = await newCustomerAuth({ phone: stranger.phone });

    const { data } = await rpc<any>(newOwner.client, "link_my_account", {});
    expect(data).toMatchObject({
      linked: false,
      outcome: "staff_merge_required",
      reason: "profile_has_kitchen_note",
    });

    // the stranger's row is untouched
    const { data: untouched } = await asAdmin()
      .from("customers").select("auth_user_id, kitchen_note").eq("id", stranger.id).single();
    expect(untouched!.auth_user_id).toBeNull();
    expect(untouched!.kitchen_note).toBe("NUT ALLERGY — anaphylaxis");

    // and the note is unreachable from this JWT by every path it has
    const { data: viaTable } = await newOwner.client
      .from("customers").select("kitchen_note").eq("id", stranger.id);
    expect(viaTable ?? [], "no row through the table").toEqual([]);

    const prof = await rpc<any>(newOwner.client, "get_my_profile", {});
    expect(prof.error, "no profile exists yet, and the refusal is explicit").not.toBeNull();
    expect(prof.error!.message).toContain("no_customer_account");

    const { data: addr } = await newOwner.client.from("customer_addresses").select("*");
    expect(addr ?? []).toEqual([]);
  });

  it("the refusal is audited on the stranger's timeline so staff can act on it", async () => {
    const stranger = await guestCustomer({ kitchen_note: "SHELLFISH" });
    const newOwner = await newCustomerAuth({ phone: stranger.phone });
    await rpc(newOwner.client, "link_my_account", {});

    const { data: events } = await asAdmin()
      .from("customer_events").select("type, payload").eq("customer_id", stranger.id);
    const link = (events ?? []).find((e: any) => e.payload?.event === "account_link");
    expect(link, "an account_link event exists").toBeTruthy();
    expect(link!.payload).toMatchObject({
      outcome: "staff_merge_required",
      reason: "profile_has_kitchen_note",
    });
  });

  it("a phone whose profile is already linked to another account is refused, not stolen", async () => {
    // auth.users.phone is itself unique, so the reachable shape is: the row was linked by email
    // (or by staff) and its `customers.phone` is what the second account verifies.
    const cust = await guestCustomer();
    const first = await newCustomerAuth({ phone: cust.phone });
    await rpc(first.client, "link_my_account", {});

    // free the auth-side phone so a second account can verify the same number
    await asSuperuser((c) => c.query(`update auth.users set phone = null where id = $1`, [first.uid]));
    const second = await newCustomerAuth({ phone: cust.phone });

    const { data } = await rpc<any>(second.client, "link_my_account", {});
    expect(data).toMatchObject({
      linked: false,
      outcome: "staff_merge_required",
      reason: "identifier_claimed",
    });

    const { data: row } = await asAdmin()
      .from("customers").select("auth_user_id").eq("id", cust.id).single();
    expect(row!.auth_user_id, "still the first account").toBe(first.uid);
  });

  it("an email on TWO rows is never a guess — a fresh profile is created instead", async () => {
    const shared = `dup-${Date.now()}@customer.test`;
    const a = await guestCustomer({ email: shared });
    const b = await guestCustomer({ email: shared });

    // the account's own phone matches nothing, so the email branch is the one under test
    const acct = await newCustomerAuth({ phone: freshPhone(), email: shared });
    const { data } = await rpc<any>(acct.client, "link_my_account", {});
    expect(data).toMatchObject({ linked: true, outcome: "created", reason: "ambiguous_email" });
    expect(data.customer_id).not.toBe(a.id);
    expect(data.customer_id).not.toBe(b.id);

    const { data: rows } = await asAdmin()
      .from("customers").select("id, auth_user_id").in("id", [a.id, b.id]);
    expect(rows!.every((r: any) => r.auth_user_id === null), "both candidates untouched").toBe(true);
  });

  it("an email on exactly ONE eligible row links it", async () => {
    const solo = `solo-${Date.now()}@customer.test`;
    const cust = await guestCustomer({ email: solo });
    const acct = await newCustomerAuth({ phone: freshPhone(), email: solo });

    const { data } = await rpc<any>(acct.client, "link_my_account", {});
    expect(data).toMatchObject({ linked: true, outcome: "linked_by_email", customer_id: cust.id });
  });

  it("a NULL email matches nothing (rows with a NULL email are not candidates)", async () => {
    const noEmail = await guestCustomer(); // email is null
    // confirm the precondition rather than assuming it: customers.email is nullable and NOT unique
    const { data: pre } = await asAdmin()
      .from("customers").select("email").eq("id", noEmail.id).single();
    expect(pre!.email).toBeNull();

    // an account with a verified phone that matches nothing and no email at all
    const acct = await newCustomerAuth({ phone: freshPhone() });
    await asSuperuser((c) =>
      c.query(`update auth.users set email_confirmed_at = null where id = $1`, [acct.uid]));

    const { data } = await rpc<any>(acct.client, "link_my_account", {});
    expect(data.outcome, "a fresh row, never the NULL-email row").toBe("created");
    expect(data.customer_id).not.toBe(noEmail.id);

    const { data: row } = await asAdmin()
      .from("customers").select("auth_user_id").eq("id", noEmail.id).single();
    expect(row!.auth_user_id).toBeNull();
  });

  it("an anonymised row is never a candidate, by phone or by email", async () => {
    const gone = `gone-${Date.now()}@customer.test`;
    const cust = await guestCustomer({ email: gone });
    await asAdmin().from("customers").update({ anonymised_at: new Date().toISOString() }).eq("id", cust.id);

    // by phone
    const byPhone = await newCustomerAuth({ phone: cust.phone });
    const r1 = await rpc<any>(byPhone.client, "link_my_account", {});
    expect(r1.data).toMatchObject({ linked: false, reason: "profile_anonymised" });

    // by email, with a free phone so a fresh row is possible
    const byEmail = await newCustomerAuth({ phone: freshPhone(), email: gone });
    const r2 = await rpc<any>(byEmail.client, "link_my_account", {});
    expect(r2.data.outcome, "fresh row, not the erased one").toBe("created");
    expect(r2.data.customer_id).not.toBe(cust.id);

    const { data: row } = await asAdmin()
      .from("customers").select("auth_user_id").eq("id", cust.id).single();
    expect(row!.auth_user_id, "the erased row stays unlinked").toBeNull();
  });

  it("unconfirmed identifiers are not identifiers", async () => {
    const cust = await guestCustomer();
    const acct = await newCustomerAuth({ phone: cust.phone, confirmPhone: false, confirmEmail: false });
    const { data } = await rpc<any>(acct.client, "link_my_account", {});
    expect(data).toMatchObject({ linked: false, outcome: "needs_verified_identifier" });

    const { data: row } = await asAdmin()
      .from("customers").select("auth_user_id").eq("id", cust.id).single();
    expect(row!.auth_user_id).toBeNull();
  });

  it("an email-only account cannot get a fresh profile — customers.phone is NOT NULL", async () => {
    // Documented refusal rather than an invented phone: a placeholder would collide on the unique
    // index and poison place_order's upsert key. This is the structural gap phase B must close.
    const acct = await newCustomerAuth(); // no phone at all
    const { data } = await rpc<any>(acct.client, "link_my_account", {});
    expect(data).toMatchObject({ linked: false, outcome: "needs_phone" });
  });

  it("a staff member cannot acquire a customer profile", async () => {
    const { signIn } = await import("./helpers");
    const owner = await signIn("owner");
    const { error } = await rpc(owner, "link_my_account", {});
    expect(error).not.toBeNull();
    expect(error!.message).toContain("staff_cannot_link");
  });

  it("anon cannot call it at all", async () => {
    const { error } = await rpc(anon(), "link_my_account", {});
    expect(error, "revoked from anon, not merely guarded inside").not.toBeNull();
  });
});

describe("the self-service surface is scoped to the caller", () => {
  let alice: CustomerAuth, bob: CustomerAuth;
  let aliceId: string, bobId: string, bobAddressId: string;

  beforeAll(async () => {
    const ac = await guestCustomer({ kitchen_note: "ALICE: no sesame" });
    const bc = await guestCustomer({ kitchen_note: "BOB: peanut anaphylaxis" });
    aliceId = ac.id;
    bobId = bc.id;
    // staff-written notes must not block the link in this fixture — clear, link, restore
    await asAdmin().from("customers").update({ kitchen_note: null }).in("id", [ac.id, bc.id]);
    alice = await newCustomerAuth({ phone: ac.phone });
    bob = await newCustomerAuth({ phone: bc.phone });
    await rpc(alice.client, "link_my_account", {});
    await rpc(bob.client, "link_my_account", {});
    await asAdmin().from("customers").update({ kitchen_note: "ALICE: no sesame" }).eq("id", ac.id);
    await asAdmin().from("customers").update({ kitchen_note: "BOB: peanut anaphylaxis" }).eq("id", bc.id);

    const { data: ba } = await asAdmin().from("customer_addresses")
      .insert({ customer_id: bobId, street: "Bob Str 1", postal_code: "10243", is_default: true })
      .select().single();
    bobAddressId = (ba as any).id;
  });

  it("get_my_profile returns the caller's own row and carries no kitchen_note at all", async () => {
    const { data } = await rpc<any>(alice.client, "get_my_profile", {});
    expect(data.customer_id).toBe(aliceId);
    expect(Object.keys(data), "kitchen_note is not in the field list").not.toContain("kitchen_note");
    expect(JSON.stringify(data)).not.toContain("sesame");
  });

  it("no RPC takes a customer id — the surface has no parameter to forge", async () => {
    const sigs = await asSuperuser((c) =>
      c.query(
        `select proname, pg_get_function_identity_arguments(oid) args from pg_proc
          where pronamespace='public'::regnamespace
            and proname in ('get_my_profile','get_my_orders','update_my_profile',
                            'add_my_address','update_my_address','delete_my_address',
                            'set_my_default_address','link_my_account')`,
      ),
    );
    for (const r of sigs.rows) {
      expect(r.args, `${r.proname} must not accept a customer id`).not.toMatch(/customer/i);
    }
  });

  it("a customer reads only their own addresses through the table", async () => {
    const { data, error } = await alice.client.from("customer_addresses").select("id, customer_id");
    expect(error).toBeNull();
    expect((data ?? []).every((r: any) => r.customer_id === aliceId)).toBe(true);
    expect((data ?? []).some((r: any) => r.id === bobAddressId)).toBe(false);
  });

  it("cross-customer address writes RAISE — a refusal, not an empty result", async () => {
    for (const [fn, args] of [
      ["update_my_address", { p_id: bobAddressId, payload: { street: "Hijacked" } }],
      ["set_my_default_address", { p_id: bobAddressId }],
      ["delete_my_address", { p_id: bobAddressId }],
    ] as const) {
      const { error } = await rpc(alice.client, fn, args as Record<string, unknown>);
      expect(error, `${fn} must raise`).not.toBeNull();
      expect(error!.message, fn).toContain("address_not_found");
    }
    const { data: still } = await asAdmin()
      .from("customer_addresses").select("street, is_default").eq("id", bobAddressId).single();
    expect(still).toMatchObject({ street: "Bob Str 1", is_default: true });
  });

  it("get_my_orders returns only the caller's orders", async () => {
    const mk = async (customer_id: string, note: string) => {
      const { data } = await asAdmin().rpc("place_order", { payload: ramenOrder() });
      await asAdmin().from("orders")
        .update({ customer_id, allergy_note: note }).eq("id", (data as any).order_id);
      return (data as any).order_id as string;
    };
    await mk(aliceId, "ALICE: no sesame");
    await mk(bobId, "BOB: peanut anaphylaxis");

    const { data } = await rpc<any>(alice.client, "get_my_orders", {});
    expect(Number(data.total)).toBeGreaterThan(0);
    expect(JSON.stringify(data), "nothing of Bob's").not.toContain("peanut");
    const ids = (data.orders as any[]).map((o) => o.order_id);
    const { data: mine } = await asAdmin().from("orders").select("id").in("id", ids).eq("customer_id", aliceId);
    expect(mine!.length, "every returned order belongs to the caller").toBe(ids.length);
  });

  it("orders stay unreadable through the table — get_my_orders is the only path", async () => {
    const { data } = await alice.client.from("orders").select("id");
    expect(data ?? [], "no customer policy was added to `orders`").toEqual([]);
  });
});

describe("update_my_profile — the customer-writable field list", () => {
  let acct: CustomerAuth, id: string;
  beforeAll(async () => {
    const c = await guestCustomer();
    id = c.id;
    acct = await newCustomerAuth({ phone: c.phone });
    await rpc(acct.client, "link_my_account", {});
    await asAdmin().from("customers").update({ kitchen_note: "DO NOT CHANGE" }).eq("id", id);
  });

  it("name, birthday and email are writable", async () => {
    const { data, error } = await rpc<any>(acct.client, "update_my_profile", {
      payload: { name: "Renamed", birthday: "1990-05-01", email: "renamed@customer.test" },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ name: "Renamed", email: "renamed@customer.test" });
  });

  it("every other field RAISES field_not_writable rather than being silently dropped", async () => {
    const forbidden: Record<string, unknown>[] = [
      { kitchen_note: "I have no allergies, feed me anything" },
      { phone: "+4900000000000" },
      { tags: ["vip"] },
      { is_company: true },
      { consent_push: { granted_at: "2026-01-01" } },
      { consent_email: { granted_at: "2026-01-01" } },
      { anonymised_at: null },
      { auth_user_id: "00000000-0000-4000-8000-000000000000" },
      { id: "00000000-0000-4000-8000-000000000000" },
    ];
    for (const payload of forbidden) {
      const { error } = await rpc(acct.client, "update_my_profile", { payload });
      const key = Object.keys(payload)[0];
      expect(error, `${key} must raise`).not.toBeNull();
      expect(error!.message, key).toContain("field_not_writable");
    }
  });

  it("the kitchen_note is provably unchanged after all of that", async () => {
    const { data } = await asAdmin().from("customers").select("kitchen_note").eq("id", id).single();
    expect(data!.kitchen_note).toBe("DO NOT CHANGE");
  });

  it("a direct table UPDATE is a silent no-op, which is why the RPC raises", async () => {
    // The distinction this project keeps re-learning: a plain write under RLS affects 0 rows and
    // reports no error, so "nothing came back" cannot be read as "it was refused".
    const { data, error } = await acct.client
      .from("customers").update({ kitchen_note: "HIJACKED" }).eq("id", id).select();
    expect(error, "no error — this is the silent class").toBeNull();
    expect(data ?? [], "and no rows").toEqual([]);
    const { data: still } = await asAdmin()
      .from("customers").select("kitchen_note").eq("id", id).single();
    expect(still!.kitchen_note).toBe("DO NOT CHANGE");
  });
});

describe("address CRUD and the one-default rule", () => {
  let acct: CustomerAuth, id: string;
  beforeAll(async () => {
    const c = await guestCustomer();
    id = c.id;
    acct = await newCustomerAuth({ phone: c.phone });
    await rpc(acct.client, "link_my_account", {});
  });

  it("the first address is the default whatever the client asks for", async () => {
    const { data } = await rpc<any>(acct.client, "add_my_address", {
      payload: { label: "Home", street: "Alice Str 1", postal_code: "10115", is_default: false },
    });
    expect(data.is_default).toBe(true);
    expect(data.zone_id, "the zone is derived server-side from the postal code").toBeTruthy();
  });

  it("at most one default per customer, enforced by the database", async () => {
    await rpc(acct.client, "add_my_address", {
      payload: { label: "Work", street: "Alice Str 2", postal_code: "10243", is_default: true },
    });
    const { data } = await asAdmin()
      .from("customer_addresses").select("id, is_default").eq("customer_id", id);
    expect(data!.filter((a: any) => a.is_default).length).toBe(1);
    expect(data!.length).toBe(2);

    // and the index refuses it even with RLS out of the way
    const raw = await asSuperuser(async (c) => {
      try {
        await c.query(
          `update public.customer_addresses set is_default = true
            where customer_id = $1 and not is_default`, [id]);
        return "allowed";
      } catch (e: any) {
        return e.message as string;
      }
    });
    expect(raw).toContain("customer_addresses_one_default_idx");
  });

  it("deleting the default promotes the oldest remaining address", async () => {
    const { data: before } = await asAdmin()
      .from("customer_addresses").select("id, is_default, created_at")
      .eq("customer_id", id).order("created_at");
    const def = before!.find((a: any) => a.is_default)!;
    await rpc(acct.client, "delete_my_address", { p_id: (def as any).id });

    const { data: after } = await asAdmin()
      .from("customer_addresses").select("id, is_default").eq("customer_id", id);
    expect(after!.length).toBe(before!.length - 1);
    expect(after!.filter((a: any) => a.is_default).length, "still exactly one default").toBe(1);
  });

  it("deleting an address that is not yours raises", async () => {
    const other = await guestCustomer();
    const { data: oa } = await asAdmin().from("customer_addresses")
      .insert({ customer_id: other.id, street: "Other 1", postal_code: "10115" }).select().single();
    const { error } = await rpc(acct.client, "delete_my_address", { p_id: (oa as any).id });
    expect(error!.message).toContain("address_not_found");
  });

  it("a customer cannot write customer_addresses directly — the RPCs are the only path", async () => {
    const { error } = await acct.client
      .from("customer_addresses").insert({ customer_id: id, street: "Direct", postal_code: "10115" });
    expect(error, "INSERT under RLS raises rather than silently dropping").not.toBeNull();
  });

  it("every *_my_* RPC refuses a JWT with no linked profile, explicitly", async () => {
    const unlinked = await newCustomerAuth(); // never linked
    for (const [fn, args] of [
      ["get_my_profile", {}],
      ["get_my_orders", {}],
      ["update_my_profile", { payload: { name: "x" } }],
      ["add_my_address", { payload: { street: "s", postal_code: "10115" } }],
      ["update_my_address", { p_id: "00000000-0000-4000-8000-000000000000", payload: {} }],
      ["set_my_default_address", { p_id: "00000000-0000-4000-8000-000000000000" }],
      ["delete_my_address", { p_id: "00000000-0000-4000-8000-000000000000" }],
    ] as const) {
      const { error } = await rpc(unlinked.client, fn, args as Record<string, unknown>);
      expect(error, `${fn} must raise`).not.toBeNull();
      expect(error!.message, fn).toContain("no_customer_account");
    }
  });
});

describe("guest checkout is unchanged (D-016)", () => {
  it("place_order still creates a customer with auth_user_id NULL, as anon", async () => {
    const payload = ramenOrder();
    const { data, error } = await rpc<any>(anon(), "place_order", { payload });
    expect(error).toBeNull();
    expect(data.number).toBeGreaterThan(0);

    const { data: cust } = await asAdmin()
      .from("customers").select("id, auth_user_id")
      .eq("phone", (payload.contact as any).phone).single();
    expect(cust!.auth_user_id, "a guest has no account").toBeNull();

    const { data: addr } = await asAdmin()
      .from("customer_addresses").select("is_default").eq("customer_id", cust!.id);
    expect(addr!.length, "the address place_order saves still lands").toBe(1);
    expect(addr![0].is_default, "and is still the default").toBe(true);
  });

  it("a repeat guest order upserts onto the same row and does not duplicate it", async () => {
    const phone = freshPhone();
    await rpc(anon(), "place_order", { payload: ramenOrder({ contact: { name: "Repeat", phone } }) });
    await rpc(anon(), "place_order", { payload: ramenOrder({ contact: { name: "Repeat", phone } }) });

    const { data: rows } = await asAdmin().from("customers").select("id").eq("phone", phone);
    expect(rows!.length, "one customer row").toBe(1);
    const { data: orders } = await asAdmin()
      .from("orders").select("id").eq("customer_id", rows![0].id);
    expect(orders!.length, "two orders on it").toBe(2);
  });

  it("the guest tracking path is untouched", async () => {
    const payload = ramenOrder();
    const { data } = await rpc<any>(anon(), "place_order", { payload });
    const { data: tracked, error } = await rpc<any>(anon(), "get_order_by_token", {
      token: data.tracking_token,
    });
    expect(error).toBeNull();
    expect(tracked.number).toBe(data.number);
  });

  it("a guest row created today is still linkable tomorrow — the feature's whole point", async () => {
    const payload = ramenOrder();
    await rpc(anon(), "place_order", { payload });
    const phone = (payload.contact as any).phone as string;

    const acct = await newCustomerAuth({ phone });
    const { data: link } = await rpc<any>(acct.client, "link_my_account", {});
    expect(link.outcome).toBe("linked_by_phone");

    const { data: orders } = await rpc<any>(acct.client, "get_my_orders", {});
    expect(Number(orders.total), "the account inherits its own guest history").toBeGreaterThan(0);
    const { data: prof } = await rpc<any>(acct.client, "get_my_profile", {});
    expect(prof.addresses.length, "and the address it saved at checkout").toBeGreaterThan(0);
  });

  it("guest checkout still works after accounts exist (no ordering dependency)", async () => {
    const payload = ramenOrder();
    const { error } = await rpc(anon(), "place_order", { payload });
    expect(error).toBeNull();
  });
});
