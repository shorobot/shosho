import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, rpc, signIn, type Db } from "./helpers";

beforeAll(openAllDay);

const granted = () => ({ granted_at: new Date().toISOString(), source: "test" });

/**
 * §8.2 resolve_segment — consent and anonymisation are the unconditional baseline; segment filters
 * (tags, min_orders, …) narrow further but can never widen past it.
 *
 * Fixture (all distinct, isolated phones):
 *   A — tags ['VIP'], consent_email granted,  2 delivered orders, not anonymised
 *   B — tags [],       consent_push  granted, 0 orders,           not anonymised
 *   C — tags ['VIP'], consent_email + push granted, ANONYMISED — must never appear, any channel
 *   D — tags [],       no consent at all,     0 orders,           not anonymised — never appears
 *   E — tags ['VIP'], consent_email granted,  0 orders,           not anonymised (for min_orders)
 */
describe("resolve_segment (§8.2)", () => {
  const ids: Record<"A" | "B" | "C" | "D" | "E", string> = { A: "", B: "", C: "", D: "", E: "" };

  beforeAll(async () => {
    const a = admin();
    const people = [
      { key: "A", phone: "+4917699001001", tags: ["VIP"], consent_email: granted(), consent_push: null, anonymised_at: null },
      { key: "B", phone: "+4917699001002", tags: [], consent_email: null, consent_push: granted(), anonymised_at: null },
      { key: "C", phone: "+4917699001003", tags: ["VIP"], consent_email: granted(), consent_push: granted(), anonymised_at: new Date().toISOString() },
      { key: "D", phone: "+4917699001004", tags: [], consent_email: null, consent_push: null, anonymised_at: null },
      { key: "E", phone: "+4917699001005", tags: ["VIP"], consent_email: granted(), consent_push: null, anonymised_at: null },
    ] as const;

    for (const p of people) {
      await a.from("orders").delete().eq("contact_phone", p.phone);
      await a.from("customers").delete().eq("phone", p.phone);
      const { data: cust, error } = await a.from("customers")
        .insert({ name: `Segment ${p.key}`, phone: p.phone, tags: p.tags, consent_email: p.consent_email,
                  consent_push: p.consent_push, anonymised_at: p.anonymised_at })
        .select("id").single();
      if (error) throw error;
      ids[p.key as keyof typeof ids] = cust!.id as string;
    }

    // A gets 2 completed orders (orders_count=2 via customer_stats); everyone else stays at 0.
    const { error } = await a.from("orders").insert([
      { channel: "website", type: "pickup", status: "delivered", payment_status: "paid", payment_method: "cash",
        contact_name: "Segment A", contact_phone: "+4917699001001", customer_id: ids.A, total_cents: 1000 },
      { channel: "website", type: "pickup", status: "picked_up", payment_status: "paid", payment_method: "cash",
        contact_name: "Segment A", contact_phone: "+4917699001001", customer_id: ids.A, total_cents: 1200 },
    ] as never);
    if (error) throw error;
  });

  async function resolved(segment: Record<string, unknown>, channel: "push" | "email" | "both") {
    const operator = await signIn("operator");
    const { data, error } = await rpc(operator, "resolve_segment", { p_segment: segment, p_channel: channel });
    if (error) throw new Error(`${error.message} ${error.details ?? ""}`);
    return (data as { customer_id: string }[]).map((r) => r.customer_id);
  }

  it("channel='email': only email-consented, non-anonymised customers", async () => {
    const got = await resolved({}, "email");
    expect(got).toEqual(expect.arrayContaining([ids.A, ids.E]));
    expect(got).not.toContain(ids.B); // push consent only
    expect(got).not.toContain(ids.C); // anonymised, despite having both consents
    expect(got).not.toContain(ids.D); // no consent at all
  });

  it("channel='push': only push-consented customers — email consent alone is not enough", async () => {
    const got = await resolved({}, "push");
    expect(got).toEqual([ids.B]);
  });

  it("channel='both': email OR push consent", async () => {
    const got = await resolved({}, "both");
    expect(got).toEqual(expect.arrayContaining([ids.A, ids.B, ids.E]));
    expect(got).not.toContain(ids.C);
    expect(got).not.toContain(ids.D);
  });

  it("segment.tags narrows, but anonymisation still wins even for a matching tag", async () => {
    const got = await resolved({ tags: ["VIP"] }, "email");
    expect(got).toEqual(expect.arrayContaining([ids.A, ids.E]));
    expect(got).not.toContain(ids.C); // VIP + email-consented, but anonymised
  });

  it("segment.min_orders excludes a consented, untagged-by-orders customer", async () => {
    const got = await resolved({ min_orders: 1 }, "email");
    expect(got).toContain(ids.A);     // 2 orders
    expect(got).not.toContain(ids.E); // 0 orders, otherwise identical to A
  });

  it("owner and operator may call it; kitchen, driver and anon may not", async () => {
    for (const role of ["owner", "operator"] as const) {
      const c = await signIn(role);
      const { error } = await rpc(c, "resolve_segment", { p_segment: {}, p_channel: "email" });
      expect(error, role).toBeNull();
    }
    for (const role of ["kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { error } = await rpc(c, "resolve_segment", { p_segment: {}, p_channel: "email" });
      expect(error?.message, role).toBe("forbidden_for_role");
    }
    const { error: anonErr } = await rpc(anon(), "resolve_segment", { p_segment: {}, p_channel: "email" });
    expect(anonErr).not.toBeNull(); // execute revoked from anon
  });
});

/**
 * §8.1 campaign_recipients — the unique (campaign_id, customer_id) constraint, and the weekly-cap
 * trigger that sits on top of it (the thing the constraint alone does not give).
 */
describe("campaign_recipients: unique constraint + weekly cap (§8.1)", () => {
  let camp1: string, camp2: string, camp3: string;
  let custA: string, custB: string, custC: string, custD: string;

  beforeAll(async () => {
    const a = admin();
    const { data: camps, error: cErr } = await a.from("campaigns").insert([
      { name: "Cap Test 1", channel: "email" },
      { name: "Cap Test 2", channel: "email" },
      { name: "Cap Test 3", channel: "email" },
    ] as never).select("id");
    if (cErr) throw cErr;
    [camp1, camp2, camp3] = camps!.map((c) => c.id as string);

    for (const phone of ["+4917699002001", "+4917699002002", "+4917699002003", "+4917699002004"]) {
      await a.from("orders").delete().eq("contact_phone", phone);
      await a.from("customers").delete().eq("phone", phone);
    }
    const { data: custs, error: custErr } = await a.from("customers").insert([
      { name: "Cap A", phone: "+4917699002001" },
      { name: "Cap B", phone: "+4917699002002" },
      { name: "Cap C", phone: "+4917699002003" },
      { name: "Cap D", phone: "+4917699002004" },
    ] as never).select("id");
    if (custErr) throw custErr;
    [custA, custB, custC, custD] = custs!.map((c) => c.id as string);
  });

  it("the same (campaign, customer) pair cannot be inserted twice", async () => {
    const a = admin();
    const { error: first } = await a.from("campaign_recipients").insert({ campaign_id: camp1, customer_id: custA } as never);
    expect(first).toBeNull();
    const { error: dup } = await a.from("campaign_recipients").insert({ campaign_id: camp1, customer_id: custA } as never);
    expect(dup).not.toBeNull();
    expect(dup!.message.toLowerCase()).toMatch(/duplicate|unique/);
  });

  it("a DIFFERENT campaign for the same customer within 7 days is refused by the weekly-cap trigger", async () => {
    const a = admin();
    const { error } = await a.from("campaign_recipients").insert({ campaign_id: camp2, customer_id: custA } as never);
    expect(error).not.toBeNull();
    expect(error!.message).toBe("weekly_cap_exceeded");
  });

  it("a `failed` prior contact does not spend the week's slot", async () => {
    const a = admin();
    const { error: firstFailed } = await a.from("campaign_recipients")
      .insert({ campaign_id: camp1, customer_id: custB, state: "failed" } as never);
    expect(firstFailed).toBeNull();
    const { error: secondOk } = await a.from("campaign_recipients").insert({ campaign_id: camp2, customer_id: custB } as never);
    expect(secondOk).toBeNull();
  });

  it("a prior contact older than 7 days does not block a new one", async () => {
    const a = admin();
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 10).toISOString(); // 10 days ago
    const { error: oldErr } = await a.from("campaign_recipients")
      .insert({ campaign_id: camp1, customer_id: custC, created_at: oldDate } as never);
    expect(oldErr).toBeNull();
    const { error: newErr } = await a.from("campaign_recipients").insert({ campaign_id: camp2, customer_id: custC } as never);
    expect(newErr).toBeNull();
  });

  it("campaign_recipients is staff read-only — no insert/update/delete policy for anyone", async () => {
    const operator = await signIn("operator");
    const { error } = await operator.from("campaign_recipients").insert({ campaign_id: camp3, customer_id: custD } as never);
    expect(error).not.toBeNull(); // RLS: no write policy exists, even for owner/operator
    const { data } = await operator.from("campaign_recipients").select("id").eq("campaign_id", camp1);
    expect(data!.length).toBeGreaterThan(0); // but they can read
    const { data: anonData, error: anonErr } = await anon().from("campaign_recipients").select("id").limit(1);
    expect(anonErr ? [] : anonData).toEqual([]);
  });
});

/**
 * §8.3 claim_campaign_recipients — unreachable with anon or authenticated (the exact shape S7-01/S1
 * found wrong in payment-worker), `for update skip locked` + stale-claim recovery.
 */
describe("claim_campaign_recipients (§8.3)", () => {
  let campaign: string;
  let rQueued: string, rStale: string, rSent: string;

  beforeAll(async () => {
    const a = admin();
    const { data: camp } = await a.from("campaigns").insert({ name: "Claim Test", channel: "email" } as never).select("id").single();
    campaign = camp!.id as string;

    for (const phone of ["+4917699003001", "+4917699003002", "+4917699003003"]) {
      await a.from("orders").delete().eq("contact_phone", phone);
      await a.from("customers").delete().eq("phone", phone);
    }
    const { data: custs } = await a.from("customers").insert([
      { name: "Claim Queued", phone: "+4917699003001" },
      { name: "Claim Stale", phone: "+4917699003002" },
      { name: "Claim Sent", phone: "+4917699003003" },
    ] as never).select("id");
    const [cQueued, cStale, cSent] = custs!.map((c) => c.id as string);

    const staleAt = new Date(Date.now() - 1000 * 60 * 20).toISOString(); // 20 minutes ago — past the 10-min timeout
    const { data: rows, error } = await a.from("campaign_recipients").insert([
      { campaign_id: campaign, customer_id: cQueued, state: "queued", claimed_at: null },
      { campaign_id: campaign, customer_id: cStale, state: "queued", claimed_at: staleAt },
      { campaign_id: campaign, customer_id: cSent, state: "sent" },
    ] as never).select("id, customer_id");
    if (error) throw error;
    rQueued = rows!.find((r) => r.customer_id === cQueued)!.id as string;
    rStale = rows!.find((r) => r.customer_id === cStale)!.id as string;
    rSent = rows!.find((r) => r.customer_id === cSent)!.id as string;
  });

  it("is unreachable with anon or any authenticated (non-service) JWT", async () => {
    const { error: anonErr } = await anon().rpc("claim_campaign_recipients", { p_limit: 10 });
    expect(anonErr).not.toBeNull();
    for (const role of ["owner", "operator", "kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { error } = await (c as Db).rpc("claim_campaign_recipients", { p_limit: 10 });
      expect(error, role).not.toBeNull(); // EXECUTE is revoked from `authenticated` entirely
    }
  });

  it("service_role claims queued rows (fresh and stale), never a `sent` one, and sets claimed_at", async () => {
    const { data, error } = await admin().rpc("claim_campaign_recipients", { p_limit: 10 });
    expect(error).toBeNull();
    const claimed = data as { id: string; claimed_at: string | null }[];
    const claimedIds = claimed.map((r) => r.id);
    expect(claimedIds).toEqual(expect.arrayContaining([rQueued, rStale]));
    expect(claimedIds).not.toContain(rSent);
    for (const r of claimed) expect(r.claimed_at).not.toBeNull();
  });

  it("a just-claimed row is not reclaimed before the 10-minute timeout", async () => {
    const { data } = await admin().rpc("claim_campaign_recipients", { p_limit: 10 });
    const claimedIds = (data as { id: string }[]).map((r) => r.id);
    expect(claimedIds).not.toContain(rQueued); // claimed moments ago in the previous test
  });
});

/**
 * §8.6/§8.7 banners_live and the publish model — the base table is owner/operator only; the view
 * (and, for settings, a column-level grant) are the only anon-reachable surfaces.
 */
describe("banners_live and publish_site (§8.6, §8.7)", () => {
  let bActive: string, bFuture: string, bExpired: string, bInactive: string;

  beforeAll(async () => {
    const a = admin();
    await a.from("banners").delete().eq("title_de", "Publish Test Banner");
    const now = Date.now();
    const { data: rows, error } = await a.from("banners").insert([
      { slot: "home_hero", title_de: "Publish Test Banner", active: true },
      { slot: "home_hero", title_de: "Publish Test Banner", active: true, valid_from: new Date(now + 1000 * 60 * 60 * 24).toISOString() },
      { slot: "home_hero", title_de: "Publish Test Banner", active: true, valid_to: new Date(now - 1000 * 60 * 60 * 24).toISOString() },
      { slot: "home_hero", title_de: "Publish Test Banner", active: false },
    ] as never).select("id, active, valid_from, valid_to");
    if (error) throw error;
    bActive = rows!.find((r) => r.active && !r.valid_from && !r.valid_to)!.id as string;
    bFuture = rows!.find((r) => r.valid_from)!.id as string;
    bExpired = rows!.find((r) => r.valid_to)!.id as string;
    bInactive = rows!.find((r) => !r.active)!.id as string;
  });

  it("banners_live shows only the active, in-window row", async () => {
    const { data: live, error } = await anon().from("banners_live").select("id").eq("title_de", "Publish Test Banner");
    expect(error).toBeNull();
    const liveIds = (live as { id: string }[]).map((r) => r.id);
    expect(liveIds).toEqual([bActive]);
    expect(liveIds).not.toContain(bFuture);
    expect(liveIds).not.toContain(bExpired);
    expect(liveIds).not.toContain(bInactive);
  });

  it("the base `banners` table is not reachable by anon at all", async () => {
    const { data, error } = await anon().from("banners").select("id").limit(1);
    expect(error ? [] : data).toEqual([]);
  });

  it("banners_live never carries `draft` — it is not in the view's column list", async () => {
    const { error } = await anon().from("banners_live").select("draft" as never);
    expect(error).not.toBeNull(); // the column does not exist on this view at all
  });

  it("publish_site is owner-only, and a settings draft is invisible to anon until published", async () => {
    const owner = await signIn("owner");
    const operator = await signIn("operator");

    const { data: before } = await admin().from("settings").select("value").eq("key", "site").single();
    const draftValue = { ...(before!.value as object), seo: { title: "DRAFT TITLE — not yet live" } };
    const { error: setDraftErr } = await owner.from("settings").update({ draft: draftValue }).eq("key", "site");
    expect(setDraftErr).toBeNull();

    // anon must never see the draft, whether asked for explicitly or via a bare select(*)
    const { error: explicitErr } = await anon().from("settings").select("draft").eq("key", "site");
    expect(explicitErr).not.toBeNull();
    const { data: starData, error: starErr } = await anon().from("settings").select("*").eq("key", "site");
    if (!starErr) expect(starData![0]).not.toHaveProperty("draft");
    // and the LIVE value must not have changed yet — anon reading `value` sees the old one
    const { data: liveBefore } = await anon().from("settings").select("value").eq("key", "site").single();
    expect((liveBefore!.value as { seo?: { title?: string } }).seo?.title).not.toBe("DRAFT TITLE — not yet live");

    // operator cannot publish
    const { error: opErr } = await rpc(operator, "publish_site", {});
    expect(opErr?.message).toBe("forbidden_for_role");
    // anon cannot even call it
    const { error: anonErr } = await rpc(anon(), "publish_site", {});
    expect(anonErr).not.toBeNull();

    // owner publishes
    const { data: pub, error: pubErr } = await rpc(owner, "publish_site", {});
    expect(pubErr).toBeNull();
    expect((pub as { settings_keys: string[] }).settings_keys).toContain("site");

    const { data: liveAfter } = await anon().from("settings").select("value").eq("key", "site").single();
    expect((liveAfter!.value as { seo?: { title?: string } }).seo?.title).toBe("DRAFT TITLE — not yet live");
    const { data: draftCleared } = await admin().from("settings").select("draft").eq("key", "site").single();
    expect(draftCleared!.draft).toBeNull();

    const { data: pubs } = await admin().from("site_publications").select("summary").order("at", { ascending: false }).limit(1);
    expect((pubs![0].summary as { settings_keys: string[] }).settings_keys).toContain("site");

    // restore, so other suites' settings assertions are unaffected
    await admin().from("settings").update({ value: before!.value }).eq("key", "site");
  });
});
