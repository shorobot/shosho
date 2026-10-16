import { describe, expect, it } from "vitest";
import { admin, asAgent, asSuperuser, signIn } from "./helpers";

/**
 * §9.1/§9.4 — the `agent` Postgres role itself: its attributes, and the refusal matrix S2-09's
 * boot asked to be proven, not inferred. S4-03's finding applies here too (RLS matching zero rows
 * returns success with an empty/zero-affected result) — every refusal below is either a genuine
 * Postgres permission error (no grant exists at all: `staff`, `review_agent_output`, the registry's
 * UPDATE) or is paired with a ground-truth read proving the row really exists and really didn't
 * change (the money columns, a finished run).
 */

describe("the agent role itself (§9.1)", () => {
  it("is LOGIN, non-BYPASSRLS, not a superuser, and cannot create databases or roles", async () => {
    const row = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        "select rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = 'agent'",
      );
      return rows[0];
    });
    expect(row, "role `agent` does not exist").toBeTruthy();
    expect(row.rolcanlogin).toBe(true);
    expect(row.rolbypassrls).toBe(false);
    expect(row.rolsuper).toBe(false);
    expect(row.rolcreatedb).toBe(false);
    expect(row.rolcreaterole).toBe(false);
  });

  it("has no password set — ALTER ROLE agent WITH PASSWORD is an out-of-band step, never a migration", async () => {
    const row = await asSuperuser(async (c) => {
      const { rows } = await c.query(
        "select rolpassword is null as no_password from pg_authid where rolname = 'agent'",
      );
      return rows[0];
    });
    expect(row.no_password).toBe(true);
  });
});

describe("agent refusals — `staff` (§9.4)", () => {
  it("cannot read `staff` at all — a genuine permission error, not an RLS-filtered empty set", async () => {
    // ground truth: staff rows really exist
    const { data: realStaff } = await admin().from("staff").select("id");
    expect((realStaff as unknown[]).length).toBeGreaterThan(0);

    await expect(asAgent((c) => c.query("select id from public.staff limit 1"))).rejects.toThrow(/permission denied/i);
  });
});

describe("agent refusals — the agents registry cannot raise its own ceiling (§9.1, §9.4)", () => {
  it("can SELECT the registry but cannot UPDATE any row in it", async () => {
    const { data: row } = await admin().from("agents").select("id, active").eq("key", "accounting").single();

    const selected = await asAgent((c) => c.query("select id, active from public.agents where key = 'accounting'"));
    expect(selected.rows).toHaveLength(1);

    await expect(
      asAgent((c) => c.query("update public.agents set active = true where id = $1", [row!.id])),
    ).rejects.toThrow(/permission denied/i);

    // ground truth: unchanged
    const { data: after } = await admin().from("agents").select("active").eq("id", row!.id).single();
    expect(after!.active).toBe(row!.active);
  });
});

describe("agent refusals — money columns on `orders` (§9.1, §9.4, migration 25's trust boundary)", () => {
  it("can SELECT orders but cannot UPDATE payment_status, the authorized/captured/refunded columns, or total_cents", async () => {
    const { data: order, error } = await admin()
      .from("orders")
      .insert({ type: "pickup", payment_method: "cash", contact_name: "Agent Refusal Check", contact_phone: "+491700000001" } as never)
      .select("id, payment_status, total_cents")
      .single();
    if (error) throw error;

    const selected = await asAgent((c) => c.query("select id from public.orders where id = $1", [order!.id]));
    expect(selected.rows).toHaveLength(1);

    for (const sql of [
      "update public.orders set payment_status = 'paid' where id = $1",
      "update public.orders set payment_authorized_cents = 500 where id = $1",
      "update public.orders set payment_captured_at = now() where id = $1",
      "update public.orders set payment_refunded_cents = 100 where id = $1",
      "update public.orders set total_cents = 999999 where id = $1",
    ]) {
      await expect(asAgent((c) => c.query(sql, [order!.id]))).rejects.toThrow(/permission denied/i);
    }

    const { data: after } = await admin().from("orders").select("payment_status, total_cents").eq("id", order!.id).single();
    expect(after!.payment_status).toBe(order!.payment_status);
    expect(after!.total_cents).toBe(order!.total_cents);
  });
});

describe("agent refusals — agent_run_logs is append-only (§9.1, §9.4)", () => {
  async function openRun(): Promise<string> {
    const { data: accAgent } = await admin().from("agents").select("id").eq("key", "accounting").single();
    const inserted = await asAgent((c) =>
      c.query("insert into public.agent_runs (agent_id) values ($1) returning id", [accAgent!.id]),
    );
    return inserted.rows[0].id as string;
  }

  it("can INSERT a log line but cannot UPDATE or DELETE it", async () => {
    const runId = await openRun();
    const inserted = await asAgent((c) =>
      c.query("insert into public.agent_run_logs (run_id, level, message) values ($1, 'info', 'hello') returning id", [runId]),
    );
    const logId = inserted.rows[0].id as string;

    await expect(
      asAgent((c) => c.query("update public.agent_run_logs set message = 'edited' where id = $1", [logId])),
    ).rejects.toThrow(/permission denied/i);
    await expect(asAgent((c) => c.query("delete from public.agent_run_logs where id = $1", [logId]))).rejects.toThrow(/permission denied/i);

    const { data: still } = await admin().from("agent_run_logs").select("message").eq("id", logId).single();
    expect(still!.message).toBe("hello");
  });
});

describe("agent refusals — a finished run can never be rewritten (§9.1, §9.6)", () => {
  it("can update progress columns on its own open run, but the update is a no-op once finished_at is set", async () => {
    const { data: growAgent } = await admin().from("agents").select("id").eq("key", "grow").single();
    const opened = await asAgent((c) =>
      c.query("insert into public.agent_runs (agent_id) values ($1) returning id", [growAgent!.id]),
    );
    const runId = opened.rows[0].id as string;

    // open run: the progress/outcome/cost column grant works
    const midRun = await asAgent((c) =>
      c.query("update public.agent_runs set cost_usd = 0.001, input_tokens = 10 where id = $1", [runId]),
    );
    expect(midRun.rowCount).toBe(1);

    // only finish_agent_run may close a run (service definer, no direct grant needed for finished_at)
    await asAgent((c) => c.query("select * from finish_agent_run($1, true)", [runId]));

    // row-scoped RLS (`finished_at is null`) now excludes it — the update matches zero rows, not an error
    const rewrite = await asAgent((c) =>
      c.query("update public.agent_runs set cost_usd = 99 where id = $1", [runId]),
    );
    expect(rewrite.rowCount).toBe(0);

    const { data: after } = await admin().from("agent_runs").select("cost_usd").eq("id", runId).single();
    expect(Number(after!.cost_usd)).toBeCloseTo(0.001, 6); // unchanged by the rewrite attempt
  });
});

describe("agent refusals — settings scoped to the `business` key only (§9.1)", () => {
  it("reads `business` but not `ops` or any other key, even though both rows exist", async () => {
    const { data: allKeys } = await admin().from("settings").select("key");
    const keys = (allKeys as { key: string }[]).map((r) => r.key);
    expect(keys).toContain("business");
    expect(keys).toContain("ops"); // ground truth: ops exists and agent still must not see it

    const business = await asAgent((c) => c.query("select key from public.settings where key = 'business'"));
    expect(business.rows).toHaveLength(1);

    const everything = await asAgent((c) => c.query("select key from public.settings"));
    expect(everything.rows.map((r: { key: string }) => r.key)).toEqual(["business"]);
  });
});

describe("agent refusals — cannot approve its own output (§9.6, the required asymmetry)", () => {
  it("can INSERT an output (always landing pending) but cannot EXECUTE review_agent_output, and cannot INSERT one pre-approved", async () => {
    const { data: accAgent } = await admin().from("agents").select("id").eq("key", "accounting").single();
    const run = await asAgent((c) =>
      c.query("insert into public.agent_runs (agent_id) values ($1) returning id", [accAgent!.id]),
    );
    const runId = run.rows[0].id as string;

    const inserted = await asAgent((c) =>
      c.query(
        "insert into public.agent_outputs (run_id, agent_id, kind, payload) values ($1, $2, 'report', $3) returning id, status",
        [runId, accAgent!.id, JSON.stringify({ total: 100 })],
      ),
    );
    expect(inserted.rows[0].status).toBe("pending");
    const outputId = inserted.rows[0].id as string;

    // cannot name status in the INSERT list even to set the same value it would default to
    await expect(
      asAgent((c) =>
        c.query(
          "insert into public.agent_outputs (run_id, agent_id, kind, payload, status) values ($1, $2, 'report', '{}', 'approved')",
          [runId, accAgent!.id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i);

    // cannot approve its own output — no EXECUTE grant at all
    await expect(
      asAgent((c) => c.query("select * from review_agent_output($1, 'approved')", [outputId])),
    ).rejects.toThrow(/permission denied/i);

    // the human path works, and only it can move status
    const owner = await signIn("owner");
    const { data: reviewed, error } = await owner.rpc("review_agent_output", { p_output_id: outputId, p_decision: "approved" });
    expect(error).toBeNull();
    expect((reviewed as { status: string }).status).toBe("approved");

    const { data: final } = await admin().from("agent_outputs").select("status, reviewer_id").eq("id", outputId).single();
    expect(final!.status).toBe("approved");
    expect(final!.reviewer_id).toBeTruthy();
  });
});
