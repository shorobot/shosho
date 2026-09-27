import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, anon, ITEM, openAllDay, POSTAL, ramenOrder, rpc, signIn } from "./helpers";

beforeAll(openAllDay);

/**
 * §1.5 / §6.9 row 5 — the rejected / abandoned checkout feed. The table is PII-free by
 * construction and `anon` may insert through record_order_attempt() only, never select.
 */
const session = () => `sess-${Math.random().toString(36).slice(2, 12)}`;

const attempt = (overrides: Record<string, unknown> = {}) => ({
  type: "delivery",
  postal_code: POSTAL.zoneB,
  subtotal_cents: 2700,
  items: [{ item_id: ITEM.ramen, qty: 2 }],
  problems: [{ code: "unavailable", item_id: ITEM.ebiTempura }],
  session_hash: session(),
  ...overrides,
});

describe("order_attempts — shape and privacy", () => {
  it("has no PII column at all", async () => {
    // ask for each forbidden name: PostgREST rejects an unknown column, which is the assertion
    for (const forbidden of ["name", "contact_name", "phone", "contact_phone", "email", "street",
                             "floor_apt", "city", "address", "courier_comment", "comment_flags",
                             "customer_id", "allergy_note"]) {
      const { error: e } = await admin().from("order_attempts").select(forbidden).limit(1);
      expect(e, `order_attempts must not have a column \`${forbidden}\``).not.toBeNull();
    }
  });

  it("the items shape is enforced by a CHECK, not by convention", async () => {
    const { error } = await admin().from("order_attempts").insert({
      type: "delivery",
      items: [{ item_id: ITEM.ramen, qty: 1, comment: "no wasabi, call me on +49176…" }],
    } as never);
    expect(error, "free text in items must be rejected").not.toBeNull();
  });

  it("anon can never select it; kitchen and driver cannot either; operator and owner can", async () => {
    await rpc(anon(), "record_order_attempt", { payload: attempt() });

    const { data: aData, error: aErr } = await anon().from("order_attempts").select("*").limit(1);
    expect(aErr ? [] : aData).toEqual([]);

    for (const role of ["kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { data } = await c.from("order_attempts").select("id").limit(1);
      expect(data ?? [], role).toEqual([]);
    }
    for (const role of ["operator", "owner"] as const) {
      const c = await signIn(role);
      const { data, error } = await c.from("order_attempts").select("id").limit(1);
      expect(error, role).toBeNull();
      expect(data!.length, role).toBeGreaterThan(0);
    }
  });
});

describe("record_order_attempt", () => {
  it("records what the guest had, drops everything else, and resolves the zone", async () => {
    const s = session();
    const { data, error } = await rpc(anon(), "record_order_attempt", {
      payload: {
        ...attempt({ session_hash: s }),
        // things a client might send that must not be stored
        items: [{ item_id: ITEM.ramen, qty: 2, comment: "no wasabi", name: "Tonkotsu" }],
        contact: { name: "Anna", phone: "+4917612345" },
        courier_comment: "2nd floor",
        promo_code: "willkommen",
      },
    });
    expect(error).toBeNull();
    expect(data).toEqual({ recorded: true });

    const { data: rows } = await admin().from("order_attempts").select("*").eq("session_hash", s);
    expect(rows).toHaveLength(1);
    const row = rows![0];
    expect(row.items).toEqual([{ item_id: ITEM.ramen, qty: 2 }]);   // comment and name dropped
    expect(row.problems).toEqual([{ code: "unavailable", item_id: ITEM.ebiTempura }]);
    expect(row.source).toBe("website");
    expect(row.type).toBe("delivery");
    expect(row.postal_code).toBe(POSTAL.zoneB);
    expect(row.zone_id).not.toBeNull();                             // resolved from the postal code
    expect(row.promo_code).toBe("WILLKOMMEN");
    expect(row.subtotal_cents).toBe(2700);
    expect(JSON.stringify(row)).not.toContain("Anna");
    expect(JSON.stringify(row)).not.toContain("2nd floor");
  });

  it("requires a type and (for anon) a session_hash", async () => {
    const { error: noType } = await rpc(anon(), "record_order_attempt", { payload: { session_hash: session() } });
    expect(noType!.message).toBe("invalid_input");
    const { error: noSession } = await rpc(anon(), "record_order_attempt", { payload: { type: "pickup" } });
    expect(noSession!.message).toBe("invalid_input");
    expect(noSession!.details).toContain("session_hash");
  });

  it("an unresolvable postal code still records, with a null zone", async () => {
    const s = session();
    const { error } = await rpc(anon(), "record_order_attempt", {
      payload: attempt({ session_hash: s, postal_code: POSTAL.outside, problems: [{ code: "out_of_zone" }] }),
    });
    expect(error).toBeNull();
    const { data: rows } = await admin().from("order_attempts").select("zone_id, problems").eq("session_hash", s);
    expect(rows![0].zone_id).toBeNull();
    expect(rows![0].problems).toEqual([{ code: "out_of_zone" }]);
  });

  describe("rate limit", () => {
    const LIMIT = 3;
    beforeAll(async () => {
      const { data } = await admin().from("settings").select("value").eq("key", "ops").single();
      await admin().from("settings")
        .update({ value: { ...(data!.value as object), attempt_rate_limit_per_min: LIMIT } })
        .eq("key", "ops");
    });
    afterAll(async () => {
      const { data } = await admin().from("settings").select("value").eq("key", "ops").single();
      await admin().from("settings")
        .update({ value: { ...(data!.value as object), attempt_rate_limit_per_min: 20 } })
        .eq("key", "ops");
    });

    it(`rejects the ${LIMIT + 1}th attempt of one session inside a minute`, async () => {
      const s = session();
      for (let i = 0; i < LIMIT; i++) {
        const { error } = await rpc(anon(), "record_order_attempt", { payload: attempt({ session_hash: s }) });
        expect(error, `attempt ${i + 1} of ${LIMIT}`).toBeNull();
      }
      const { error } = await rpc(anon(), "record_order_attempt", { payload: attempt({ session_hash: s }) });
      expect(error!.message).toBe("rate_limited");

      const { count } = await admin().from("order_attempts")
        .select("id", { count: "exact", head: true }).eq("session_hash", s);
      expect(count).toBe(LIMIT);          // the rejected call wrote nothing

      // another session is unaffected — the limit is per session, not global
      const { error: other } = await rpc(anon(), "record_order_attempt", { payload: attempt() });
      expect(other).toBeNull();
    });
  });
});

describe("place_order refusal", () => {
  it("points the client at record_order_attempt and writes no row itself", async () => {
    // count only rows with no session_hash — the shape place_order would have written
    const before = await admin().from("order_attempts")
      .select("id", { count: "exact", head: true }).is("session_hash", null);
    const { error } = await rpc(anon(), "place_order", {
      payload: ramenOrder({ address: { street: "Nowhere 1", postal_code: POSTAL.outside, city: "Berlin" } }),
    });
    expect(error).not.toBeNull();
    expect(error!.message).toBe("order_rejected");
    expect(error!.hint).toContain("record_order_attempt");
    expect(JSON.parse(error!.details)).toContainEqual(expect.objectContaining({ code: "out_of_zone" }));

    // PostgREST runs one transaction per request and place_order rejects by raising, so it cannot
    // commit an attempt row — the client records it with the problems[] above. See migration 21.
    const after = await admin().from("order_attempts")
      .select("id", { count: "exact", head: true }).is("session_hash", null);
    expect(after.count).toBe(before.count);

    // …and the same problems[] round-trips through the RPC
    const s = session();
    const { error: rec } = await rpc(anon(), "record_order_attempt", {
      payload: { type: "delivery", postal_code: POSTAL.outside, session_hash: s, problems: JSON.parse(error!.details) },
    });
    expect(rec).toBeNull();
    const { data: rows } = await admin().from("order_attempts").select("problems").eq("session_hash", s);
    expect((rows![0].problems as { code: string }[]).map((p) => p.code)).toContain("out_of_zone");
  });
});
