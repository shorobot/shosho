"use client";

// BO · Automation — the registry (boot task 5). `agents_staff_all` is owner/operator full CRUD, so
// toggling `active` and editing `config` need no RPC. Only Accounting has an orchestrator behind it
// today (plan.md C3/S5-01) — the other four are inactive by design, and this screen says so rather
// than offering a toggle that silently achieves nothing (the honesty S4-04 applied to "Senden").
import { useEffect, useState } from "react";
import { NumberField, Row, Section, Switch } from "@/components/menu/Fields";
import { Badge } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { agentConfigOf, agentLabelKey, isAgentImplemented, type AgentConfig, type AgentRow } from "@/lib/automation";
import { useI18n } from "@/lib/i18n";
import { useAutomation } from "@/lib/automationStore";
import { ddmmHHmm } from "@/lib/time";

function ceilingToDollars(n: number | undefined): number | null {
  return n == null ? null : Math.round(n);
}

function AgentCard({ agent }: { agent: AgentRow }) {
  const { t, lang } = useI18n();
  const { canWrite, setAgentActive, saveAgentConfig } = useAutomation();
  const stored = agentConfigOf(agent.config);
  const [perRun, setPerRun] = useState<number | null>(ceilingToDollars(stored.ceiling_usd_per_run));
  const [perDay, setPerDay] = useState<number | null>(ceilingToDollars(stored.ceiling_usd_per_day));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPerRun(ceilingToDollars(stored.ceiling_usd_per_run));
    setPerDay(ceilingToDollars(stored.ceiling_usd_per_day));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id, agent.config]);

  const dirty = perRun !== ceilingToDollars(stored.ceiling_usd_per_run) || perDay !== ceilingToDollars(stored.ceiling_usd_per_day);
  const implemented = isAgentImplemented(agent.key);
  const labelKey = agentLabelKey(agent.key);

  return (
    <div className="flex flex-col gap-3 rounded-[16px] bg-field-2 p-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[14px] font-extrabold">{labelKey ? t(labelKey) : agent.key}</span>
        {!implemented && <Badge tone="muted">{t("auto.registry.notImplemented")}</Badge>}
        <span className="ml-auto text-[11px] text-ink-3">{agent.last_run_at ? t("auto.registry.lastRun", { t: ddmmHHmm(agent.last_run_at) }) : t("auto.registry.noRunYet")}</span>
      </div>

      <Switch
        checked={agent.active}
        disabled={!canWrite}
        onChange={(v) => void setAgentActive(lang, agent.id, v)}
        label={t("auto.registry.active")}
        hint={implemented ? t("auto.registry.activeHint") : t("auto.registry.activeHintInert")}
      />

      <Row cols={2}>
        <NumberField label={t("auto.registry.ceilingPerRun")} value={perRun} onChange={setPerRun} suffix="USD" placeholder={t("auto.registry.noCeiling")} disabled={!canWrite} />
        <NumberField label={t("auto.registry.ceilingPerDay")} value={perDay} onChange={setPerDay} suffix="USD" placeholder={t("auto.registry.noCeiling")} disabled={!canWrite} />
      </Row>

      {canWrite && (
        <div>
          <Pill
            size="sm"
            disabled={!dirty || busy}
            onClick={async () => {
              setBusy(true);
              const next: AgentConfig = {};
              if (perRun != null) next.ceiling_usd_per_run = perRun;
              if (perDay != null) next.ceiling_usd_per_day = perDay;
              await saveAgentConfig(lang, agent.id, next);
              setBusy(false);
            }}
          >
            {t("set.save")}
          </Pill>
        </div>
      )}
    </div>
  );
}

export function RegistryPanel() {
  const { t } = useI18n();
  const { agents } = useAutomation();

  return (
    <Section title={t("auto.registry.title")} hint={t("auto.registry.hint")}>
      <div className="flex flex-col gap-3">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
      </div>
    </Section>
  );
}
