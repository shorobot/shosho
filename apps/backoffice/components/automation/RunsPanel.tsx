"use client";

// BO · Automation — runs, live (boot task 2). Clicking a row opens its ordered log lines.
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Section } from "@/components/menu/Fields";
import { EmptyState } from "@/components/ui/States";
import { agentLabelKey, durationLabel, runOutcome, runSeconds, tokens, usd, type AgentRunRow } from "@/lib/automation";
import { useI18n, type Key } from "@/lib/i18n";
import { useAutomation } from "@/lib/automationStore";
import { ddmmHHmm } from "@/lib/time";
import { RunLogDrawer } from "@/components/automation/RunLogDrawer";

function outcomeTone(o: ReturnType<typeof runOutcome>): "amber" | "ok" | "alert" | "muted" {
  if (o === "running") return "amber";
  if (o === "success") return "ok";
  if (o === "failure") return "alert";
  return "muted";
}

/** `conclusion` is S5's free-text vocabulary (migration 33) — only the three names this boot knows
 * about get a translated label; anything else (a future agent's own word) renders as itself. */
function outcomeLabel(t: (k: Key) => string, o: ReturnType<typeof runOutcome>): string {
  if (o === "running") return t("auto.outcome.running");
  if (o === "success") return t("auto.outcome.success");
  if (o === "failure") return t("auto.outcome.failure");
  return o;
}

export function RunsPanel() {
  const { t, lang } = useI18n();
  const { agents, runs, now } = useAutomation();
  const [openRun, setOpenRun] = useState<string | null>(null);
  const agentKeyById = new Map(agents.map((a) => [a.id, a.key]));
  const agentLabel = (id: string): string => {
    const key = agentKeyById.get(id);
    if (!key) return "—";
    const lk = agentLabelKey(key);
    return lk ? t(lk) : key;
  };

  return (
    <Section title={t("auto.runs.title")} hint={t("auto.runs.hint")}>
      {runs.length === 0 ? (
        <EmptyState icon="▶" title={t("auto.runs.emptyTitle")} body={t("auto.runs.emptyBody")} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line-2 text-left">
                {(["auto.th.agent", "auto.th.started", "auto.th.outcome", "auto.th.duration", "auto.th.tokens", "auto.th.cost"] as Key[]).map((k) => (
                  <th key={k} className="label-caps px-3 py-2.5 font-medium">
                    {t(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 50).map((run: AgentRunRow) => {
                const outcome = runOutcome(run);
                return (
                  <tr
                    key={run.id}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-field-2"
                    onClick={() => setOpenRun(run.id)}
                  >
                    <td className="px-3 py-2.5 font-medium">{agentLabel(run.agent_id)}</td>
                    <td className="px-3 py-2.5 text-ink-3">{ddmmHHmm(run.started_at)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={outcomeTone(outcome)}>{outcomeLabel(t, outcome)}</Badge>
                    </td>
                    <td className="px-3 py-2.5 text-ink-3">{durationLabel(runSeconds(run, now))}</td>
                    <td className="px-3 py-2.5 text-ink-3">
                      {run.input_tokens == null && run.output_tokens == null ? "—" : `${tokens(run.input_tokens, lang)} / ${tokens(run.output_tokens, lang)}`}
                    </td>
                    <td className="px-3 py-2.5 text-ink-3">{usd(run.cost_usd)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <RunLogDrawer runId={openRun} onClose={() => setOpenRun(null)} />
    </Section>
  );
}
