// Pure logic for BO · Automation (api-contracts §8.8/§8.8a/§8.8b, docs/security.md §9.3/§9.6).
// No React, no Supabase — covered by tests/automation.test.ts.
import type { PostgrestError } from "@supabase/supabase-js";
import type { Key } from "@/lib/i18n";
import { dayKey, TZ } from "@/lib/time";
import type { Enums, Json, Tables } from "@/lib/types";

export type AgentRow = Tables["agents"]["Row"];
export type AgentTaskRow = Tables["agent_tasks"]["Row"];
export type AgentRunRow = Tables["agent_runs"]["Row"];
export type AgentRunLogRow = Tables["agent_run_logs"]["Row"];
export type AgentOutputRow = Tables["agent_outputs"]["Row"];

export type AgentTaskStatus = Enums["agent_task_status"];
export type AgentOutputStatus = Enums["agent_output_status"];

/* ------------------------------------------------------------------ the registry (task 5) */

/**
 * Seed order (migration 33) — used to sort the registry list the way the owner expects to read it
 * (dependency order from plan.md section C), not whatever order PostgREST happens to return.
 */
export const AGENT_KEY_ORDER = ["accounting", "grow", "warehouse", "sales", "quality"] as const;

/**
 * Which agents actually do something today. Only Accounting (plan.md C3/S5-01) has an orchestrator
 * behind it; Grow/Warehouse/Sales/Quality are seeded rows with nothing reading them yet (C6/C9/C10,
 * and Quality is deferred by the owner, D-020). This set has to be updated by hand as each later
 * agent ships — there is no column anywhere that says "has code" — flagged in this boot's report as
 * a rough edge rather than hidden.
 */
const IMPLEMENTED_AGENT_KEYS = new Set(["accounting"]);

export function isAgentImplemented(key: string): boolean {
  return IMPLEMENTED_AGENT_KEYS.has(key);
}

/** i18n key for one agent's display name, or `null` for a key outside the seeded five (the registry
 * is free text, migration 33, and could grow — this just means a future one renders its raw `key`). */
const AGENT_LABEL_KEY: Record<string, Key> = {
  sales: "auto.agent.sales",
  accounting: "auto.agent.accounting",
  warehouse: "auto.agent.warehouse",
  grow: "auto.agent.grow",
  quality: "auto.agent.quality",
};

export function agentLabelKey(key: string): Key | null {
  return AGENT_LABEL_KEY[key] ?? null;
}

export function sortAgents(rows: AgentRow[]): AgentRow[] {
  return [...rows].sort((a, b) => {
    const ia = AGENT_KEY_ORDER.indexOf(a.key as (typeof AGENT_KEY_ORDER)[number]);
    const ib = AGENT_KEY_ORDER.indexOf(b.key as (typeof AGENT_KEY_ORDER)[number]);
    if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    return a.key.localeCompare(b.key);
  });
}

/**
 * The spend-ceiling convention this boot gives `agents.config` — §9.3 asks for a per-run and a
 * per-day ceiling "held in agents.config" but no agent has ever written one (S5-01 builds the first
 * agent in parallel with this boot). Chosen here so the dashboard has something concrete to read;
 * flagged in the report as a convention for S0/S5 to ratify or correct, not a contract this boot can
 * fix in place (docs/api-contracts.md is propose-only from here).
 */
export type AgentConfig = {
  run_ceiling_usd?: number;
  day_ceiling_usd?: number;
};

export function agentConfigOf(value: Json): AgentConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const v = value as Record<string, Json>;
  const num = (k: string) => (typeof v[k] === "number" && v[k] > 0 ? (v[k] as number) : undefined);
  return { run_ceiling_usd: num("run_ceiling_usd"), day_ceiling_usd: num("day_ceiling_usd") };
}

export function agentConfigToJson(cfg: AgentConfig): Json {
  const out: Record<string, Json> = {};
  if (cfg.run_ceiling_usd !== undefined) out.run_ceiling_usd = cfg.run_ceiling_usd;
  if (cfg.day_ceiling_usd !== undefined) out.day_ceiling_usd = cfg.day_ceiling_usd;
  return out;
}

/* ------------------------------------------------------------------ the queue (task 2) */

export const TASK_STATUSES: AgentTaskStatus[] = ["queued", "processing", "done", "failed"];

export function queueCounts(tasks: AgentTaskRow[]): Record<AgentTaskStatus, number> {
  const out: Record<AgentTaskStatus, number> = { queued: 0, processing: 0, done: 0, failed: 0 };
  for (const t of tasks) out[t.status]++;
  return out;
}

/** `claim_agent_tasks` reclaims a `processing` row after 10 minutes with no `finish_agent_run` — a
 * task sitting past that is stuck, not merely slow, and the dashboard should say so. */
export function isStaleProcessing(task: Pick<AgentTaskRow, "status" | "started_at">, now: Date): boolean {
  if (task.status !== "processing" || !task.started_at) return false;
  return now.getTime() - new Date(task.started_at).getTime() > 10 * 60 * 1000;
}

/* ------------------------------------------------------------------ runs (task 2) */

export type RunOutcome = "running" | "success" | "failure" | string;

export function runOutcome(run: Pick<AgentRunRow, "finished_at" | "conclusion">): RunOutcome {
  if (!run.finished_at) return "running";
  return run.conclusion ?? "success";
}

/** Seconds elapsed so far (running) or total (finished) — always available since `started_at` is not null. */
export function runSeconds(run: Pick<AgentRunRow, "started_at" | "finished_at">, now: Date): number {
  const end = run.finished_at ? new Date(run.finished_at).getTime() : now.getTime();
  return Math.max(0, Math.round((end - new Date(run.started_at).getTime()) / 1000));
}

export function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/* ------------------------------------------------------------------ logs (task 2) */

/** Ordered by `seq`, never `at` — migration 33's own reason: concurrent writers can share a millisecond. */
export function sortLogs(logs: AgentRunLogRow[]): AgentRunLogRow[] {
  return [...logs].sort((a, b) => a.seq - b.seq);
}

/* ------------------------------------------------------------------ spend (task 4, security.md §9.3) */

export type SpendTotals = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  runs: number;
  /** Finished runs that reported no cost at all — a blind spot (§9.3), not zero spend. */
  uncosted: number;
};

function emptyTotals(): SpendTotals {
  return { costUsd: 0, inputTokens: 0, outputTokens: 0, runs: 0, uncosted: 0 };
}

/** Per agent, per Berlin calendar day. Only finished runs count — a run in flight has not spent its
 * final total yet, and showing a partial figure as if it were the day's total would understate a
 * ceiling breach rather than overstate it, which is the wrong direction to be wrong in. */
export function spendByAgentDay(runs: AgentRunRow[], tz = TZ): Map<string, Map<string, SpendTotals>> {
  const byAgent = new Map<string, Map<string, SpendTotals>>();
  for (const r of runs) {
    if (!r.finished_at) continue;
    const day = dayKey(new Date(r.finished_at), tz);
    let byDay = byAgent.get(r.agent_id);
    if (!byDay) {
      byDay = new Map();
      byAgent.set(r.agent_id, byDay);
    }
    const t = byDay.get(day) ?? emptyTotals();
    t.runs++;
    if (r.cost_usd == null) t.uncosted++;
    else t.costUsd += r.cost_usd;
    if (r.input_tokens != null) t.inputTokens += r.input_tokens;
    if (r.output_tokens != null) t.outputTokens += r.output_tokens;
    byDay.set(day, t);
  }
  return byAgent;
}

export function sumTotals(rows: SpendTotals[]): SpendTotals {
  const out = emptyTotals();
  for (const r of rows) {
    out.costUsd += r.costUsd;
    out.inputTokens += r.inputTokens;
    out.outputTokens += r.outputTokens;
    out.runs += r.runs;
    out.uncosted += r.uncosted;
  }
  return out;
}

export type SpendAlarm = "no_ceiling" | "ok" | "approaching" | "over";

/** 80% — an early warning before the ceiling actually bites, not the ceiling itself. */
export const APPROACHING_FRACTION = 0.8;

export function spendAlarm(costUsd: number, ceiling: number | undefined): SpendAlarm {
  if (ceiling == null) return "no_ceiling";
  if (costUsd >= ceiling) return "over";
  if (costUsd >= ceiling * APPROACHING_FRACTION) return "approaching";
  return "ok";
}

/* ------------------------------------------------------------------ approvals (task 3, §8.8b) */

/** What the UI may ever send as a decision — `pending` is deliberately absent: a review cannot be
 * un-made, and `review_agent_output` rejects it with `invalid_input` if asked. */
export const REVIEW_DECISIONS = ["approved", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export type ReviewErrorCode = "forbidden" | "invalid_decision" | "already_reviewed" | "other";
export type ReviewError = { code: ReviewErrorCode; message: string };

/**
 * `review_agent_output`'s three named failure shapes (api-contracts §8.8b), mapped the same way
 * `lib/actions.ts`'s `mapError` reads `set_order_status`'s — by message substring and `errcode`,
 * because PostgREST hands back the raised message as `error.message` and the errcode as `error.code`.
 */
export function mapReviewError(e: Pick<PostgrestError, "message" | "code">): ReviewError {
  const m = e.message ?? "";
  if (e.code === "42501" || m.includes("forbidden_for_role")) return { code: "forbidden", message: m };
  if (m.includes("output_not_found_or_already_reviewed")) return { code: "already_reviewed", message: m };
  if (m.includes("invalid_input")) return { code: "invalid_decision", message: m };
  return { code: "other", message: m || "unknown" };
}

export function pendingOutputs(outputs: AgentOutputRow[]): AgentOutputRow[] {
  return outputs.filter((o) => o.status === "pending");
}

export function reviewedOutputs(outputs: AgentOutputRow[]): AgentOutputRow[] {
  return outputs.filter((o) => o.status !== "pending").sort((a, b) => (b.reviewed_at ?? "").localeCompare(a.reviewed_at ?? ""));
}

/* ------------------------------------------------------------------ formatting */

export function usd(amount: number | null | undefined): string {
  if (amount == null) return "—";
  const digits = Math.abs(amount) > 0 && Math.abs(amount) < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
}

export function tokens(n: number | null | undefined, lang: "de" | "en" = "de"): string {
  if (n == null) return "—";
  return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-GB").format(n);
}
