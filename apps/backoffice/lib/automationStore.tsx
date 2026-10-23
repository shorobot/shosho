"use client";

// One load of everything BO · Automation shows (api-contracts §8.8/§8.8a/§8.8b). `agents`
// (registry) is a plain refetch-after-save, per migration 33's own comment — it is deliberately NOT
// in the realtime publication. `agent_tasks` / `agent_runs` / `agent_outputs` ARE, so each gets a
// `postgres_changes` subscription that refetches the one affected row (never trusts the payload),
// the same shape lib/store.tsx's orders board already uses and for the same reason: a diff applied
// locally can drift from a row another writer touched a second time before this client re-rendered.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useSupabase } from "@/components/providers/EnvProvider";
import {
  mapReviewError, sortAgents,
  type AgentOutputRow, type AgentRow, type AgentRunRow, type AgentRunLogRow, type AgentTaskRow,
  type AgentConfig, type ReviewDecision, type ReviewError,
} from "@/lib/automation";
import { agentConfigToJson } from "@/lib/automation";
import { translate, type Key, type Lang } from "@/lib/i18n";
import { run as guardedRun } from "@/lib/menuStore";
import { toast } from "@/lib/toast";
import { wrote } from "@/lib/write";
import type { Staff, StaffDirectoryRow } from "@/lib/types";

const KEYS: { denied: Key; saveError: Key } = { denied: "auto.denied", saveError: "auto.saveError" };

export function run<R extends { data: unknown; error: { code?: string; message?: string } | null }>(lang: Lang, op: () => PromiseLike<R>) {
  return guardedRun(lang, op as never, KEYS);
}

/** Replace a row by id, or prepend it when it is not here yet — never diffed, always the fetched truth. */
function upsertById<T extends { id: string }>(list: T[], row: T): T[] {
  const i = list.findIndex((x) => x.id === row.id);
  if (i === -1) return [row, ...list];
  const next = [...list];
  next[i] = row;
  return next;
}

export type Connection = "connecting" | "live" | "lost";

export type AutomationData = {
  me: Staff;
  canWrite: boolean;
  agents: AgentRow[];
  tasks: AgentTaskRow[];
  runs: AgentRunRow[];
  outputs: AgentOutputRow[];
  /** `staff_directory` (§6.9 row 2), to show a reviewer's name rather than a bare uuid. */
  staffDirectory: StaffDirectoryRow[];
  loading: boolean;
  error: string | null;
  connection: Connection;
  now: Date;
  reload: () => Promise<void>;
  reconnect: () => void;
  /** `review_agent_output` — the only path that may move `status` off `pending` (§8.8b). Returns
   * `null` on success (the row is upserted locally); a `ReviewError` otherwise, including the
   * already-reviewed case two operators on two tablets will actually hit. */
  reviewOutput: (lang: Lang, outputId: string, decision: ReviewDecision, note?: string) => Promise<ReviewError | null>;
  setAgentActive: (lang: Lang, agentId: string, active: boolean) => Promise<boolean>;
  saveAgentConfig: (lang: Lang, agentId: string, config: AgentConfig) => Promise<boolean>;
};

const Ctx = createContext<AutomationData | null>(null);

/** How many recent rows each list keeps — this is an operational dashboard, not an archive; the
 * audit trail of record is the table itself (read-only here either way). Exported so a panel that
 * aggregates these rows (SpendPanel) can say when its figures might be short of the full day. */
export const RECENT_LIMIT = 300;

export function AutomationProvider({ me, children }: { me: Staff; children: ReactNode }) {
  const supabase = useSupabase();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [tasks, setTasks] = useState<AgentTaskRow[]>([]);
  const [runs, setRuns] = useState<AgentRunRow[]>([]);
  const [outputs, setOutputs] = useState<AgentOutputRow[]>([]);
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [now, setNow] = useState(() => new Date());
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    const [ag, tk, rn, out, dir] = await Promise.all([
      supabase.from("agents").select("*"),
      supabase.from("agent_tasks").select("*").order("created_at", { ascending: false }).limit(RECENT_LIMIT),
      supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(RECENT_LIMIT),
      supabase.from("agent_outputs").select("*").order("created_at", { ascending: false }).limit(RECENT_LIMIT),
      supabase.from("staff_directory").select("*"),
    ]);
    setError(ag.error?.message ?? tk.error?.message ?? rn.error?.message ?? out.error?.message ?? null);
    setAgents(sortAgents(ag.data ?? []));
    setTasks(tk.data ?? []);
    setRuns(rn.data ?? []);
    setOutputs(out.data ?? []);
    setStaffDirectory(dir.data ?? []);
    setLoading(false);
  }, [supabase]);

  const refetchRow = useCallback(
    async <T extends { id: string }>(table: "agent_tasks" | "agent_runs" | "agent_outputs", id: string, apply: (row: T) => void) => {
      const { data } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
      if (data) apply(data as unknown as T);
    },
    [supabase],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // realtime: agent_tasks / agent_runs / agent_outputs, debounced per-row refetch (never a payload diff)
  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let alive = true;
    setConnection("connecting");
    const pending = new Map<string, ReturnType<typeof setTimeout>>();

    const schedule = (key: string, fn: () => void) => {
      const prev = pending.get(key);
      if (prev) clearTimeout(prev);
      pending.set(
        key,
        setTimeout(() => {
          pending.delete(key);
          fn();
        }, 150),
      );
    };

    channel = supabase
      .channel(`automation-${epoch}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_tasks" }, (p) => {
        const id = (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id;
        if (id) schedule(`task:${id}`, () => void refetchRow<AgentTaskRow>("agent_tasks", id, (row) => setTasks((list) => upsertById(list, row))));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_runs" }, (p) => {
        const id = (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id;
        if (id) schedule(`run:${id}`, () => void refetchRow<AgentRunRow>("agent_runs", id, (row) => setRuns((list) => upsertById(list, row))));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_outputs" }, (p) => {
        const id = (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id;
        if (id) schedule(`output:${id}`, () => void refetchRow<AgentOutputRow>("agent_outputs", id, (row) => setOutputs((list) => upsertById(list, row))));
      })
      .subscribe((status) => {
        if (!alive) return;
        if (status === "SUBSCRIBED") setConnection("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setConnection("lost");
      });

    return () => {
      alive = false;
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, epoch, refetchRow]);

  const reconnect = useCallback(() => setEpoch((e) => e + 1), []);

  const reviewOutput = useCallback(
    async (lang: Lang, outputId: string, decision: ReviewDecision, note?: string): Promise<ReviewError | null> => {
      const { data, error } = await supabase.rpc("review_agent_output", { p_output_id: outputId, p_decision: decision, p_note: note ?? undefined });
      if (error) {
        const mapped = mapReviewError(error);
        // "already reviewed" is a designed outcome (two operators, two tablets), not a bug — refetch
        // so this screen shows the row's real status instead of whatever this client thought it was.
        if (mapped.code === "already_reviewed") void refetchRow<AgentOutputRow>("agent_outputs", outputId, (row) => setOutputs((list) => upsertById(list, row)));
        return mapped;
      }
      if (data) setOutputs((list) => upsertById(list, data as AgentOutputRow));
      return null;
    },
    [supabase, refetchRow],
  );

  const setAgentActive = useCallback(
    async (lang: Lang, agentId: string, active: boolean): Promise<boolean> => {
      const res = await run(lang, () => supabase.from("agents").update({ active }).eq("id", agentId).select("*"));
      if (res == null) return false;
      if (!wrote(res)) {
        toast(translate(lang, "auto.noop"));
        return false;
      }
      const row = (res as AgentRow[])[0];
      if (!row) return false;
      setAgents((list) => sortAgents(upsertById(list, row)));
      return true;
    },
    [supabase],
  );

  const saveAgentConfig = useCallback(
    async (lang: Lang, agentId: string, config: AgentConfig): Promise<boolean> => {
      const res = await run(lang, () => supabase.from("agents").update({ config: agentConfigToJson(config) }).eq("id", agentId).select("*"));
      if (res == null) return false;
      if (!wrote(res)) {
        toast(translate(lang, "auto.noop"));
        return false;
      }
      const row = (res as AgentRow[])[0];
      if (!row) return false;
      setAgents((list) => sortAgents(upsertById(list, row)));
      toast(translate(lang, "auto.saved"), "ok");
      return true;
    },
    [supabase],
  );

  const value = useMemo<AutomationData>(
    () => ({
      me,
      canWrite: me.role === "owner" || me.role === "operator",
      agents, tasks, runs, outputs, staffDirectory, loading, error, connection, now,
      reload, reconnect, reviewOutput, setAgentActive, saveAgentConfig,
    }),
    [me, agents, tasks, runs, outputs, staffDirectory, loading, error, connection, now, reload, reconnect, reviewOutput, setAgentActive, saveAgentConfig],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAutomation(): AutomationData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAutomation outside AutomationProvider");
  return v;
}

/* ------------------------------------------------------------------ one run's log lines (task 2) */

/**
 * Loaded on demand (not with the rest of the screen) — a run's logs can be long, and most runs on
 * screen are never opened. Append-only, same pattern `useCustomerDetail` uses for `customer_events`:
 * a filtered INSERT subscription, de-duplicated against an echo of this client's own fetch.
 */
export function useRunLogs(runId: string | null): { logs: AgentRunLogRow[]; loading: boolean } {
  const supabase = useSupabase();
  const [logs, setLogs] = useState<AgentRunLogRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runId) {
      setLogs([]);
      return;
    }
    let alive = true;
    setLoading(true);
    void supabase
      .from("agent_run_logs")
      .select("*")
      .eq("run_id", runId)
      .order("seq", { ascending: true })
      .then(({ data }) => {
        if (alive) {
          setLogs(data ?? []);
          setLoading(false);
        }
      });
    const channel = supabase
      .channel(`agent_run_logs:${runId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_run_logs", filter: `run_id=eq.${runId}` }, (payload) => {
        const row = payload.new as AgentRunLogRow;
        setLogs((prev) => (prev.some((l) => l.id === row.id) ? prev : [...prev, row].sort((a, b) => a.seq - b.seq)));
      })
      .subscribe();
    return () => {
      alive = false;
      void supabase.removeChannel(channel);
    };
  }, [supabase, runId]);

  return { logs, loading };
}
