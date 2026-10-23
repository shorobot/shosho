"use client";

// BO · Automation — the task queue (boot task 2). Depth by status, then the recent rows themselves;
// a `processing` row past the 10-minute reclaim window (migration 33's `claim_agent_tasks`) is
// flagged stale rather than left looking merely slow.
import { Badge, Count } from "@/components/ui/Badge";
import { Section } from "@/components/menu/Fields";
import { EmptyState } from "@/components/ui/States";
import { agentLabelKey, isStaleProcessing, queueCounts, TASK_STATUSES, type AgentTaskRow } from "@/lib/automation";
import { useI18n, type Key } from "@/lib/i18n";
import { useAutomation } from "@/lib/automationStore";
import { ddmmHHmm } from "@/lib/time";

const STATUS_KEY: Record<AgentTaskRow["status"], Key> = {
  queued: "auto.task.queued",
  processing: "auto.task.processing",
  done: "auto.task.done",
  failed: "auto.task.failed",
};
const STATUS_TONE: Record<AgentTaskRow["status"], "sky" | "amber" | "muted" | "alert"> = {
  queued: "sky",
  processing: "amber",
  done: "muted",
  failed: "alert",
};

export function QueuePanel() {
  const { t } = useI18n();
  const { agents, tasks, now } = useAutomation();
  const counts = queueCounts(tasks);
  const agentKey = new Map(agents.map((a) => [a.id, a.key]));
  const agentLabel = (id: string): string => {
    const key = agentKey.get(id);
    if (!key) return "—";
    const lk = agentLabelKey(key);
    return lk ? t(lk) : key;
  };

  return (
    <Section title={t("auto.queue.title")} hint={t("auto.queue.hint")}>
      <div className="flex flex-wrap gap-2">
        {TASK_STATUSES.map((s) => (
          <Count key={s} tone={s === "failed" && counts[s] > 0 ? "alert" : "muted"}>
            {t(STATUS_KEY[s])} · {counts[s]}
          </Count>
        ))}
      </div>

      {tasks.length === 0 ? (
        <EmptyState icon="⏳" title={t("auto.queue.emptyTitle")} body={t("auto.queue.emptyBody")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line-2 text-left">
                {(["auto.th.agent", "auto.th.status", "auto.th.attempts", "auto.th.created", "auto.th.error"] as Key[]).map((k) => (
                  <th key={k} className="label-caps px-3 py-2.5 font-medium">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasks.slice(0, 50).map((task) => {
                const stale = isStaleProcessing(task, now);
                return (
                  <tr key={task.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5 font-medium">{agentLabel(task.agent_id)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={stale ? "alert" : STATUS_TONE[task.status]}>
                        {t(STATUS_KEY[task.status])}
                        {stale ? ` · ${t("auto.task.stale")}` : ""}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-ink-3">{task.attempts}</td>
                    <td className="px-3 py-2.5 text-ink-3">{ddmmHHmm(task.created_at)}</td>
                    <td className="max-w-[260px] truncate px-3 py-2.5 text-ink-3" title={task.last_error ?? ""}>
                      {task.last_error ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
