"use client";

// BO · Automation — the spend alarm (boot task 4, docs/security.md §9.3). The failure this guards
// against is a runaway loop billing the owner's Anthropic account with no rate limiter in front of
// it, so "approaching or over the ceiling" must be visible at a glance, not buried in a table — and
// a ceiling that is not configured must say so rather than implying there is no spend.
import { Badge } from "@/components/ui/Badge";
import { Section } from "@/components/menu/Fields";
import {
  agentConfigOf, agentLabelKey, spendAlarm, spendByAgentDay, tokens, usd,
  type SpendAlarm,
} from "@/lib/automation";
import { useI18n, type Key } from "@/lib/i18n";
import { RECENT_LIMIT, useAutomation } from "@/lib/automationStore";
import { dayKey, TZ } from "@/lib/time";

const ALARM_TONE: Record<SpendAlarm, "muted" | "ok" | "amber" | "alert"> = {
  no_ceiling: "muted",
  ok: "ok",
  approaching: "amber",
  over: "alert",
};
const ALARM_KEY: Record<SpendAlarm, Key> = {
  no_ceiling: "auto.spend.noCeiling",
  ok: "auto.spend.ok",
  approaching: "auto.spend.approaching",
  over: "auto.spend.over",
};

export function SpendPanel() {
  const { t, lang } = useI18n();
  const { agents, runs } = useAutomation();
  const byAgentDay = spendByAgentDay(runs);
  const today = dayKey(new Date(), TZ);

  return (
    <Section title={t("auto.spend.title")} hint={t("auto.spend.hint")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line-2 text-left">
              {(["auto.th.agent", "auto.th.todaySpend", "auto.th.todayTokens", "auto.th.ceiling"] as Key[]).map((k) => (
                <th key={k} className="label-caps px-3 py-2.5 font-medium">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const lk = agentLabelKey(a.key);
              const totals = byAgentDay.get(a.id)?.get(today);
              const ceiling = agentConfigOf(a.config).day_ceiling_usd;
              const alarm = totals ? spendAlarm(totals.costUsd, ceiling) : ceiling == null ? "no_ceiling" : "ok";
              return (
                <tr key={a.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5 font-medium">{lk ? t(lk) : a.key}</td>
                  <td className="px-3 py-2.5 text-ink-3">
                    {!totals || totals.runs === 0 ? (
                      <span className="text-muted">{t("auto.spend.noRunToday")}</span>
                    ) : (
                      <>
                        {usd(totals.costUsd)}
                        {totals.uncosted > 0 && <span className="ml-1.5 text-[10px] text-muted">({t("auto.spend.uncosted", { n: totals.uncosted })})</span>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-ink-3">{!totals || totals.runs === 0 ? "—" : `${tokens(totals.inputTokens, lang)} / ${tokens(totals.outputTokens, lang)}`}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={ALARM_TONE[alarm]}>
                      {ceiling == null ? t("auto.spend.noCeiling") : `${usd(totals?.costUsd ?? 0)} / ${usd(ceiling)} · ${t(ALARM_KEY[alarm])}`}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {runs.length >= RECENT_LIMIT && <p className="text-[11px] text-muted">{t("auto.spend.windowNote", { n: RECENT_LIMIT })}</p>}
    </Section>
  );
}
