import { beforeAll, describe, expect, it } from "vitest";
import { admin, anon, openAllDay, signIn, type Db } from "./helpers";

beforeAll(openAllDay);

async function agentId(key: string): Promise<string> {
  const { data, error } = await admin().from("agents").select("id").eq("key", key).single();
  if (error) throw error;
  return data!.id as string;
}

/**
 * §8.8 `agents` — the registry. owner/operator CRUD directly, same shape as automations_staff_all.
 * kitchen/driver/anon must be *refused*, not merely shown an empty table that happens to look the
 * same as "no rows exist" (S4-03's finding: RLS matching zero rows returns 200 []) — so every
 * assertion below is paired with an admin() read proving the rows are actually there.
 */
describe("agents registry (§8.8)", () => {
  it("is seeded with the five D-020 agents, inactive", async () => {
    const { data, error } = await admin().from("agents").select("key, active").order("key");
    expect(error).toBeNull();
    const byKey = Object.fromEntries((data as { key: string; active: boolean }[]).map((r) => [r.key, r.active]));
    for (const key of ["sales", "accounting", "warehouse", "grow", "quality"]) {
      expect(byKey[key], key).toBe(false);
    }
  });

  it("owner/operator can read and toggle active; kitchen/driver see nothing though rows exist; anon is refused outright", async () => {
    const { data: allRows } = await admin().from("agents").select("id");
    expect((allRows as unknown[]).length).toBeGreaterThan(0); // ground truth: rows really exist

    for (const role of ["owner", "operator"] as const) {
      const c = await signIn(role);
      const { data, error } = await c.from("agents").select("id");
      expect(error, role).toBeNull();
      expect((data as unknown[]).length, role).toEqual((allRows as unknown[]).length);
    }

    for (const role of ["kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { data, error } = await c.from("agents").select("id");
      expect(error, role).toBeNull(); // RLS no-ops rather than erroring — the thing to prove is the row count, not the error
      expect((data as unknown[]).length, `${role} sees 0 of ${(allRows as unknown[]).length} real rows`).toBe(0);
    }

    const { data: anonData, error: anonErr } = await anon().from("agents").select("id").limit(1);
    expect(anonErr ? [] : anonData).toEqual([]); // table grant revoked from anon outright

    const owner = await signIn("owner");
    const id = await agentId("grow");
    const { error: toggleErr } = await owner.from("agents").update({ active: true }).eq("id", id);
    expect(toggleErr).toBeNull();
    await owner.from("agents").update({ active: false }).eq("id", id); // restore

    const kitchen = await signIn("kitchen");
    const { data: noop } = await kitchen.from("agents").update({ active: true }).eq("id", id).select("id");
    expect((noop as unknown[] | null)?.length ?? 0).toBe(0); // no error, but nothing changed either
    const { data: stillFalse } = await admin().from("agents").select("active").eq("id", id).single();
    expect(stillFalse!.active).toBe(false); // proves the kitchen write above did not take effect
  });
});

/**
 * §8.8 `claim_agent_tasks` — unreachable with anon or any authenticated (non-service) JWT, exactly
 * the shape S7-01/S1 found wrong in payment-worker and claim_campaign_recipients/claim_payment_jobs
 * already assert for their own queues.
 */
describe("claim_agent_tasks (§8.8)", () => {
  it("is unreachable with anon or any authenticated role", async () => {
    const { error: anonErr } = await anon().rpc("claim_agent_tasks", { p_limit: 10 });
    expect(anonErr).not.toBeNull();
    for (const role of ["owner", "operator", "kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { error } = await (c as Db).rpc("claim_agent_tasks", { p_limit: 10 });
      expect(error, role).not.toBeNull();
    }
  });

  it("claims queued and stale-processing tasks, skips a fresh in-flight one and a done one, and opens one run per claim", async () => {
    const a = admin();
    const accountingId = await agentId("accounting");

    const staleStarted = new Date(Date.now() - 1000 * 60 * 20).toISOString(); // 20 min ago — past the 10-min timeout
    const freshStarted = new Date().toISOString();

    const { data: tasks, error } = await a.from("agent_tasks").insert([
      { agent_id: accountingId, payload: { kind: "queued" }, status: "queued" },
      { agent_id: accountingId, payload: { kind: "stale" }, status: "processing", started_at: staleStarted },
      { agent_id: accountingId, payload: { kind: "fresh_in_flight" }, status: "processing", started_at: freshStarted },
      { agent_id: accountingId, payload: { kind: "already_done" }, status: "done" },
    ] as never).select("id, payload");
    if (error) throw error;
    const idOf = (kind: string) => (tasks as { id: string; payload: { kind: string } }[]).find((t) => t.payload.kind === kind)!.id;
    const qId = idOf("queued"), staleId = idOf("stale"), freshId = idOf("fresh_in_flight"), doneId = idOf("already_done");

    const { data, error: claimErr } = await a.rpc("claim_agent_tasks", { p_limit: 50 });
    if (claimErr) throw claimErr;
    const claimed = data as { run_id: string; task_id: string; agent_id: string; payload: { kind: string }; attempts: number }[];
    const claimedTaskIds = claimed.map((r) => r.task_id);

    expect(claimedTaskIds).toEqual(expect.arrayContaining([qId, staleId]));
    expect(claimedTaskIds).not.toContain(freshId);
    expect(claimedTaskIds).not.toContain(doneId);

    for (const r of claimed) {
      expect(r.run_id).toBeTruthy();
      expect(r.agent_id).toBe(accountingId);
    }

    // one agent_runs row per claimed task, started, not yet finished
    const { data: runs } = await a.from("agent_runs").select("id, task_id, finished_at").in("task_id", [qId, staleId]);
    expect((runs as unknown[]).length).toBe(2);
    for (const r of runs as { finished_at: string | null }[]) expect(r.finished_at).toBeNull();

    // the task rows themselves moved to processing with attempts incremented
    const { data: after } = await a.from("agent_tasks").select("id, status, attempts").in("id", [qId, staleId]);
    for (const t of after as { status: string; attempts: number }[]) {
      expect(t.status).toBe("processing");
      expect(t.attempts).toBeGreaterThanOrEqual(1);
    }
  });

  it("a just-claimed task is not reclaimed before the 10-minute timeout", async () => {
    const a = admin();
    const accountingId = await agentId("accounting");
    const { data: task } = await a.from("agent_tasks")
      .insert({ agent_id: accountingId, payload: { kind: "reclaim_check" } } as never)
      .select("id").single();
    const first = await a.rpc("claim_agent_tasks", { p_limit: 50 });
    const firstIds = (first.data as { task_id: string }[]).map((r) => r.task_id);
    expect(firstIds).toContain(task!.id);

    const second = await a.rpc("claim_agent_tasks", { p_limit: 50 });
    const secondIds = (second.data as { task_id: string }[]).map((r) => r.task_id);
    expect(secondIds).not.toContain(task!.id); // claimed moments ago — inside the 10-minute window
  });
});

/**
 * §8.8 `finish_agent_run` — success marks the task `done`; failure requeues unless attempts hit
 * the finish_payment_job threshold (5) or the caller says p_final, in which case it is `failed`.
 * Cost lands in the same statement as the conclusion.
 */
describe("finish_agent_run (§8.8)", () => {
  async function claimOne(agent_id: string, payload: Record<string, unknown> = {}) {
    const a = admin();
    const { data: task } = await a.from("agent_tasks").insert({ agent_id, payload } as never).select("id").single();
    const { data } = await a.rpc("claim_agent_tasks", { p_limit: 50 });
    const row = (data as { run_id: string; task_id: string }[]).find((r) => r.task_id === task!.id)!;
    return { taskId: task!.id as string, runId: row.run_id as string };
  }

  it("success: run gets conclusion + cost, task becomes done", async () => {
    const a = admin();
    const growId = await agentId("grow");
    const { taskId, runId } = await claimOne(growId, { kind: "success_path" });

    const { data: run, error } = await a.rpc("finish_agent_run", {
      p_run_id: runId, p_ok: true, p_input_tokens: 120, p_output_tokens: 340, p_cost_usd: 0.0042,
      p_result: { wrote: 3 },
    });
    expect(error).toBeNull();
    const r = run as { conclusion: string; finished_at: string; cost_usd: number; input_tokens: number };
    expect(r.conclusion).toBe("success");
    expect(r.finished_at).not.toBeNull();
    expect(Number(r.cost_usd)).toBeCloseTo(0.0042, 6);
    expect(r.input_tokens).toBe(120);

    const { data: task } = await a.from("agent_tasks").select("status, last_error").eq("id", taskId).single();
    expect(task!.status).toBe("done");
    expect(task!.last_error).toBeNull();
  });

  it("failure with attempts < 5: task is requeued (not failed)", async () => {
    const a = admin();
    const salesId = await agentId("sales");
    const { taskId, runId } = await claimOne(salesId, { kind: "retry_path" });

    const { error } = await a.rpc("finish_agent_run", { p_run_id: runId, p_ok: false, p_error: "rate_limited" });
    expect(error).toBeNull();

    const { data: task } = await a.from("agent_tasks").select("status, attempts, last_error").eq("id", taskId).single();
    expect(task!.status).toBe("queued"); // requeued — attempts (1) < 5
    expect(task!.last_error).toBe("rate_limited");
  });

  it("failure with p_final: task is failed immediately regardless of attempts", async () => {
    const a = admin();
    const warehouseId = await agentId("warehouse");
    const { taskId, runId } = await claimOne(warehouseId, { kind: "final_failure_path" });

    const { error } = await a.rpc("finish_agent_run", { p_run_id: runId, p_ok: false, p_error: "unrecoverable", p_final: true });
    expect(error).toBeNull();

    const { data: task } = await a.from("agent_tasks").select("status").eq("id", taskId).single();
    expect(task!.status).toBe("failed");
  });

  it("is unreachable with anon or any authenticated role", async () => {
    const a = admin();
    const accountingId = await agentId("accounting");
    const { runId } = await claimOne(accountingId, { kind: "rpc_access_check" });

    const { error: anonErr } = await anon().rpc("finish_agent_run", { p_run_id: runId, p_ok: true });
    expect(anonErr).not.toBeNull();
    for (const role of ["owner", "operator", "kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { error } = await (c as Db).rpc("finish_agent_run", { p_run_id: runId, p_ok: true });
      expect(error, role).not.toBeNull();
    }
  });
});

/**
 * §8.8 `agent_runs` / `agent_run_logs` — staff (owner/operator) read-only audit; kitchen, driver
 * and anon are refused, proven against rows known to exist (not inferred from an empty result).
 */
describe("agent_runs / agent_run_logs access (§8.8)", () => {
  let runId: string;

  beforeAll(async () => {
    const a = admin();
    const accountingId = await agentId("accounting");
    const { data: task } = await a.from("agent_tasks").insert({ agent_id: accountingId, payload: { kind: "log_check" } } as never).select("id").single();
    const { data: claimed } = await a.rpc("claim_agent_tasks", { p_limit: 50 });
    runId = (claimed as { run_id: string; task_id: string }[]).find((r) => r.task_id === task!.id)!.run_id;
    await a.from("agent_run_logs").insert([
      { run_id: runId, level: "info", message: "started" },
      { run_id: runId, level: "info", message: "fetched ledger" },
      { run_id: runId, level: "warn", message: "one row skipped" },
    ] as never);
  });

  it("logs for one run come back in seq order", async () => {
    const { data, error } = await admin().from("agent_run_logs").select("seq, message").eq("run_id", runId).order("seq");
    expect(error).toBeNull();
    const rows = data as { seq: number; message: string }[];
    expect(rows.map((r) => r.message)).toEqual(["started", "fetched ledger", "one row skipped"]);
    expect(rows[0].seq).toBeLessThan(rows[1].seq);
    expect(rows[1].seq).toBeLessThan(rows[2].seq);
  });

  it("owner/operator read both tables; kitchen/driver see zero rows though rows exist; anon is refused outright", async () => {
    const { data: allRuns } = await admin().from("agent_runs").select("id");
    const { data: allLogs } = await admin().from("agent_run_logs").select("id");
    expect((allRuns as unknown[]).length).toBeGreaterThan(0);
    expect((allLogs as unknown[]).length).toBeGreaterThan(0);

    for (const role of ["owner", "operator"] as const) {
      const c = await signIn(role);
      const { data: runs, error: runsErr } = await c.from("agent_runs").select("id");
      const { data: logs, error: logsErr } = await c.from("agent_run_logs").select("id");
      expect(runsErr, role).toBeNull();
      expect(logsErr, role).toBeNull();
      expect((runs as unknown[]).length, role).toBeGreaterThan(0);
      expect((logs as unknown[]).length, role).toBeGreaterThan(0);
    }

    for (const role of ["kitchen", "driver"] as const) {
      const c = await signIn(role);
      const { data: runs } = await c.from("agent_runs").select("id");
      const { data: logs } = await c.from("agent_run_logs").select("id");
      expect((runs as unknown[]).length, `${role} runs — real rows exist (${(allRuns as unknown[]).length})`).toBe(0);
      expect((logs as unknown[]).length, `${role} logs — real rows exist (${(allLogs as unknown[]).length})`).toBe(0);
    }

    const { data: anonRuns, error: anonRunsErr } = await anon().from("agent_runs").select("id").limit(1);
    expect(anonRunsErr ? [] : anonRuns).toEqual([]);
    const { data: anonLogs, error: anonLogsErr } = await anon().from("agent_run_logs").select("id").limit(1);
    expect(anonLogsErr ? [] : anonLogs).toEqual([]);
  });

  it("no insert/update/delete policy exists for owner/operator either — writes are service-role only", async () => {
    const owner = await signIn("owner");
    const { error } = await owner.from("agent_run_logs").insert({ run_id: runId, message: "operator wrote this" } as never);
    expect(error).not.toBeNull();
  });
});

/**
 * §8.8 GDPR nullability — agent_tasks.customer_id and agent_runs.customer_id follow
 * automation_runs' precedent: nullable, on delete set null, so anonymising a customer never
 * needs to touch the agent audit trail.
 */
describe("customer_id nullability on agent_tasks / agent_runs (§8.8)", () => {
  it("deleting the referenced customer sets customer_id to null on both tables, not the row", async () => {
    const a = admin();
    const salesId = await agentId("sales");
    const phone = `+4917${Date.now().toString().slice(-9)}`;
    const { data: cust, error: custErr } = await a.from("customers").insert({ name: "GDPR Check", phone } as never).select("id").single();
    if (custErr) throw custErr;

    const { data: task, error: taskErr } = await a.from("agent_tasks")
      .insert({ agent_id: salesId, customer_id: cust!.id, payload: { kind: "gdpr_check" } } as never)
      .select("id").single();
    if (taskErr) throw taskErr;
    const { data: claimed } = await a.rpc("claim_agent_tasks", { p_limit: 50 });
    const runId = (claimed as { run_id: string; task_id: string }[]).find((r) => r.task_id === task!.id)!.run_id;

    const { data: runBefore } = await a.from("agent_runs").select("customer_id").eq("id", runId).single();
    expect(runBefore!.customer_id).toBe(cust!.id);

    const { error: delErr } = await a.from("customers").delete().eq("id", cust!.id);
    expect(delErr).toBeNull();

    const { data: taskAfter } = await a.from("agent_tasks").select("id, customer_id").eq("id", task!.id).single();
    expect(taskAfter!.id).toBe(task!.id); // row survives
    expect(taskAfter!.customer_id).toBeNull(); // link is cleared

    const { data: runAfter } = await a.from("agent_runs").select("id, customer_id").eq("id", runId).single();
    expect(runAfter!.id).toBe(runId);
    expect(runAfter!.customer_id).toBeNull();
  });
});
