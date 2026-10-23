// BO · Automation logic (api-contracts §8.8/§8.8a/§8.8b, docs/security.md §9.3/§9.6). The two
// groups that matter most: the approval function's three named failure shapes must each be told
// apart (boot task 3/6 — "surface the refusal as a refusal", not a generic error), and the spend
// figures must distinguish "no run yet" / "no ceiling configured" from an actual zero (task 1/4).
import { describe, expect, it } from "vitest";
import {
  agentConfigOf, agentConfigToJson, agentLabelKey, APPROACHING_FRACTION, durationLabel,
  isAgentImplemented, isStaleProcessing, mapReviewError, pendingOutputs, queueCounts,
  reviewedOutputs, runOutcome, runSeconds, sortAgents, sortLogs, spendAlarm, spendByAgentDay,
  sumTotals, tokens, usd,
  type AgentOutputRow, type AgentRow, type AgentRunLogRow, type AgentRunRow, type AgentTaskRow,
} from "@/lib/automation";

function task(over: Partial<AgentTaskRow> = {}): AgentTaskRow {
  return {
    id: "t1", agent_id: "a1", customer_id: null, payload: {}, status: "queued", attempts: 0,
    last_error: null, started_at: null, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z",
    ...over,
  } as AgentTaskRow;
}

function run(over: Partial<AgentRunRow> = {}): AgentRunRow {
  return {
    id: "r1", task_id: "t1", agent_id: "a1", customer_id: null, started_at: "2026-10-20T10:00:00Z",
    finished_at: null, conclusion: null, error: null, input_tokens: null, output_tokens: null,
    cost_usd: null, result: null, created_at: "2026-10-20T10:00:00Z",
    ...over,
  } as AgentRunRow;
}

function agent(over: Partial<AgentRow> = {}): AgentRow {
  return { id: "a1", key: "accounting", active: false, config: {}, last_run_at: null, created_at: "", updated_at: "", ...over } as AgentRow;
}

function output(over: Partial<AgentOutputRow> = {}): AgentOutputRow {
  return {
    id: "o1", run_id: "r1", agent_id: "a1", kind: "report", payload: {}, status: "pending",
    reviewer_id: null, reviewed_at: null, review_note: null, created_at: "2026-10-20T10:00:00Z",
    ...over,
  } as AgentOutputRow;
}

/* ================================================================ the queue */

describe("queueCounts", () => {
  it("counts every status, including zero for one never seen", () => {
    const counts = queueCounts([task({ status: "queued" }), task({ status: "queued" }), task({ status: "failed" })]);
    expect(counts).toEqual({ queued: 2, processing: 0, done: 0, failed: 1 });
  });
});

describe("isStaleProcessing", () => {
  const now = new Date("2026-10-20T10:20:00Z");
  it("flags a processing task past the 10-minute reclaim window (migration 33)", () => {
    expect(isStaleProcessing(task({ status: "processing", started_at: "2026-10-20T10:09:00Z" }), now)).toBe(true);
  });
  it("does not flag one still within the window", () => {
    expect(isStaleProcessing(task({ status: "processing", started_at: "2026-10-20T10:15:00Z" }), now)).toBe(false);
  });
  it("never flags a queued/done/failed task, whatever started_at says", () => {
    expect(isStaleProcessing(task({ status: "queued", started_at: "2026-10-20T09:00:00Z" }), now)).toBe(false);
  });
});

/* ================================================================ runs & logs */

describe("runOutcome / runSeconds / durationLabel", () => {
  it("reads 'running' while finished_at is null, regardless of conclusion", () => {
    expect(runOutcome(run({ finished_at: null }))).toBe("running");
  });
  it("defaults a finished run with no conclusion to 'success'", () => {
    expect(runOutcome(run({ finished_at: "2026-10-20T10:01:00Z", conclusion: null }))).toBe("success");
  });
  it("passes through a custom conclusion", () => {
    expect(runOutcome(run({ finished_at: "2026-10-20T10:01:00Z", conclusion: "partial" }))).toBe("partial");
  });
  it("measures elapsed time against `now` while running", () => {
    const now = new Date("2026-10-20T10:00:42Z");
    expect(runSeconds(run({ started_at: "2026-10-20T10:00:00Z", finished_at: null }), now)).toBe(42);
  });
  it("measures the closed interval once finished, ignoring `now`", () => {
    const now = new Date("2026-10-20T11:00:00Z");
    expect(runSeconds(run({ started_at: "2026-10-20T10:00:00Z", finished_at: "2026-10-20T10:00:05Z" }), now)).toBe(5);
  });
  it("formats seconds/minutes/hours", () => {
    expect(durationLabel(5)).toBe("5s");
    expect(durationLabel(65)).toBe("1m 5s");
    expect(durationLabel(3661)).toBe("1h 1m");
  });
});

describe("sortLogs", () => {
  it("orders by seq, not by `at` — concurrent writers can share a millisecond (migration 33)", () => {
    const logs: AgentRunLogRow[] = [
      { id: "l2", run_id: "r1", seq: 2, at: "2026-10-20T10:00:00Z", level: "info", message: "b" },
      { id: "l1", run_id: "r1", seq: 1, at: "2026-10-20T10:00:00Z", level: "info", message: "a" },
    ];
    expect(sortLogs(logs).map((l) => l.message)).toEqual(["a", "b"]);
  });
});

/* ================================================================ the registry (task 5) */

describe("sortAgents / agentLabelKey / isAgentImplemented", () => {
  it("orders by plan.md's dependency order, not alphabetically", () => {
    const rows = [agent({ id: "1", key: "quality" }), agent({ id: "2", key: "accounting" }), agent({ id: "3", key: "grow" })];
    expect(sortAgents(rows).map((a) => a.key)).toEqual(["accounting", "grow", "quality"]);
  });
  it("puts an unknown future key last rather than crashing", () => {
    const rows = [agent({ id: "1", key: "future_agent" }), agent({ id: "2", key: "accounting" })];
    expect(sortAgents(rows).map((a) => a.key)).toEqual(["accounting", "future_agent"]);
  });
  it("resolves a label key only for the five seeded agents", () => {
    expect(agentLabelKey("accounting")).toBe("auto.agent.accounting");
    expect(agentLabelKey("future_agent")).toBeNull();
  });
  it("only Accounting is wired to an orchestrator as of S5-01's first boot", () => {
    expect(isAgentImplemented("accounting")).toBe(true);
    expect(isAgentImplemented("sales")).toBe(false);
    expect(isAgentImplemented("grow")).toBe(false);
  });
});

describe("agentConfigOf / agentConfigToJson — the spend-ceiling convention this boot gives agents.config", () => {
  it("reads a configured ceiling", () => {
    expect(agentConfigOf({ day_ceiling_usd: 20, run_ceiling_usd: 2 })).toEqual({ day_ceiling_usd: 20, run_ceiling_usd: 2 });
  });
  it("treats a missing, non-numeric or non-positive value as unconfigured, never as zero", () => {
    expect(agentConfigOf({})).toEqual({ run_ceiling_usd: undefined, day_ceiling_usd: undefined });
    expect(agentConfigOf({ day_ceiling_usd: 0 })).toEqual({ run_ceiling_usd: undefined, day_ceiling_usd: undefined });
    expect(agentConfigOf({ day_ceiling_usd: "20" })).toEqual({ run_ceiling_usd: undefined, day_ceiling_usd: undefined });
    expect(agentConfigOf(null)).toEqual({});
  });
  it("round-trips only the keys actually set", () => {
    expect(agentConfigToJson({ day_ceiling_usd: 20 })).toEqual({ day_ceiling_usd: 20 });
    expect(agentConfigToJson({})).toEqual({});
  });
});

/* ================================================================ spend (task 4, §9.3) */

describe("spendByAgentDay", () => {
  it("only counts finished runs — a run in flight has not spent its final total yet", () => {
    const rows = [run({ agent_id: "a1", finished_at: null, cost_usd: 99 }), run({ id: "r2", agent_id: "a1", finished_at: "2026-10-20T10:05:00Z", cost_usd: 1 })];
    const byDay = spendByAgentDay(rows);
    expect(byDay.get("a1")?.get("2026-10-20")?.costUsd).toBe(1);
  });
  it("tracks a finished run with no reported cost as 'uncosted', not as zero spend", () => {
    const rows = [run({ agent_id: "a1", finished_at: "2026-10-20T10:05:00Z", cost_usd: null })];
    const totals = spendByAgentDay(rows).get("a1")?.get("2026-10-20");
    expect(totals?.costUsd).toBe(0);
    expect(totals?.uncosted).toBe(1);
    expect(totals?.runs).toBe(1);
  });
  it("buckets by Berlin calendar day, summing tokens and cost", () => {
    const rows = [
      run({ agent_id: "a1", finished_at: "2026-10-20T23:50:00Z", cost_usd: 1, input_tokens: 10, output_tokens: 5 }),
      run({ id: "r2", agent_id: "a1", finished_at: "2026-10-20T23:58:00Z", cost_usd: 2, input_tokens: 20, output_tokens: 15 }),
    ];
    const totals = spendByAgentDay(rows, "Europe/Berlin").get("a1")?.get("2026-10-21"); // 23:50 UTC is already 01:50 CEST the next day
    expect(totals).toEqual({ costUsd: 3, inputTokens: 30, outputTokens: 20, runs: 2, uncosted: 0 });
  });
});

describe("sumTotals", () => {
  it("adds every field across rows", () => {
    const sum = sumTotals([
      { costUsd: 1, inputTokens: 10, outputTokens: 5, runs: 1, uncosted: 0 },
      { costUsd: 2, inputTokens: 20, outputTokens: 15, runs: 2, uncosted: 1 },
    ]);
    expect(sum).toEqual({ costUsd: 3, inputTokens: 30, outputTokens: 20, runs: 3, uncosted: 1 });
  });
});

describe("spendAlarm", () => {
  it("says 'no_ceiling' rather than 'ok' when nothing is configured — not the same claim", () => {
    expect(spendAlarm(50, undefined)).toBe("no_ceiling");
  });
  it("is ok below the approaching threshold", () => {
    expect(spendAlarm(1, 20)).toBe("ok");
  });
  it(`is 'approaching' at the ${APPROACHING_FRACTION * 100}% threshold`, () => {
    expect(spendAlarm(16, 20)).toBe("approaching");
    expect(spendAlarm(15.99, 20)).toBe("ok");
  });
  it("is over once spend reaches the ceiling", () => {
    expect(spendAlarm(20, 20)).toBe("over");
    expect(spendAlarm(25, 20)).toBe("over");
  });
});

/* ================================================================ approvals (task 3/6, §8.8b) */

describe("mapReviewError — review_agent_output's three named failures, told apart", () => {
  it("maps 42501 / forbidden_for_role to 'forbidden'", () => {
    expect(mapReviewError({ code: "42501", message: "forbidden_for_role" }).code).toBe("forbidden");
    expect(mapReviewError({ code: "", message: "forbidden_for_role" }).code).toBe("forbidden");
  });
  it("maps the already-reviewed race to its own code — two operators, two tablets", () => {
    expect(mapReviewError({ code: "P0002", message: "output_not_found_or_already_reviewed" }).code).toBe("already_reviewed");
  });
  it("maps a rejected decision (e.g. 'pending') to invalid_decision", () => {
    expect(mapReviewError({ code: "P0001", message: "invalid_input" }).code).toBe("invalid_decision");
  });
  it("falls back to 'other' for anything unrecognised, keeping the raw message", () => {
    const e = mapReviewError({ code: "XXYYY", message: "something else" });
    expect(e.code).toBe("other");
    expect(e.message).toBe("something else");
  });
});

describe("pendingOutputs / reviewedOutputs", () => {
  const rows = [
    output({ id: "o1", status: "pending" }),
    output({ id: "o2", status: "approved", reviewed_at: "2026-10-20T09:00:00Z" }),
    output({ id: "o3", status: "rejected", reviewed_at: "2026-10-20T11:00:00Z" }),
  ];
  it("keeps only pending for the approval queue", () => {
    expect(pendingOutputs(rows).map((o) => o.id)).toEqual(["o1"]);
  });
  it("keeps the rest, most recently reviewed first", () => {
    expect(reviewedOutputs(rows).map((o) => o.id)).toEqual(["o3", "o2"]);
  });
});

/* ================================================================ formatting */

describe("usd / tokens", () => {
  it("renders an unavailable amount as a dash, never as $0.00", () => {
    expect(usd(null)).toBe("—");
    expect(usd(undefined)).toBe("—");
  });
  it("shows extra precision for sub-dollar amounts, where $0.00 would hide everything", () => {
    expect(usd(0.0421)).toBe("$0.0421");
    expect(usd(12.3)).toBe("$12.30");
  });
  it("renders an unavailable token count as a dash", () => {
    expect(tokens(null)).toBe("—");
  });
});
