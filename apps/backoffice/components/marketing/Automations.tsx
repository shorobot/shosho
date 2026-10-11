"use client";

// Automations (§8.4). One row per kind, seeded inactive by the migration — `welcome`,
// `win_back_45d`, `birthday`, `review_after_delivery`.
//
// NOTHING RUNS THEM. S5's runner is the thing that would read `active` + `config` and write
// `last_run_at`; it does not exist. So the toggle stores intent and the panel says exactly that
// rather than implying a switch that starts sending. `automation_runs` is a read-only audit trail
// with no write policy for any role, which is why it is empty and why that is not a defect.
//
// The weekly cap stated under the list is `campaign_recipients_enforce_weekly_cap()` — a BEFORE
// INSERT trigger, not a rule this screen enforces. Saying so matters: an operator who believed the
// UI held the cap might look for it here when it bites.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { NumberField, Row, Section, Switch, TextArea } from "@/components/menu/Fields";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { fullDateTime } from "@/lib/datetime";
import { useI18n, type Key } from "@/lib/i18n";
import { configOf, configToJson, type AutomationConfig, type AutomationRow } from "@/lib/marketing";
import { run, useMarketing } from "@/lib/marketingStore";
import { toast } from "@/lib/toast";
import type { Json } from "@/lib/types";
import { wrote } from "@/lib/write";

export function Automations() {
  const { t } = useI18n();
  const { automations, runs } = useMarketing();

  return (
    <>
      <Section title={t("mkt.automations")} hint={t("mkt.autoNothingRuns")}>
        <div className="flex flex-col gap-2">
          {automations.map((a) => (
            <AutomationRowView key={a.id} row={a} />
          ))}
        </div>
        <span className="text-[11px] leading-[1.5] text-muted">{t("mkt.autoRule")}</span>
      </Section>

      <Section title={t("mkt.autoRuns")}>
        {runs.length === 0 ? (
          <EmptyState icon="◷" title={t("mkt.autoRunsEmptyTitle")} body={t("mkt.autoRunsEmptyBody")} />
        ) : (
          <div className="flex flex-col gap-1">
            {runs.map((r) => (
              <span key={r.id} className="text-[11px] text-ink-3">
                {t("mkt.autoRunRow", { d: fullDateTime(r.at), o: r.outcome })}
              </span>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function AutomationRowView({ row }: { row: AutomationRow }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { canWrite, reload } = useMarketing();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<AutomationConfig>(() => configOf(row.config));
  const [busy, setBusy] = useState(false);

  async function patch(values: { active?: boolean; config?: Json }) {
    setBusy(true);
    const res = await run(lang, () => supabase.from("automations").update(values).eq("id", row.id).select("id"));
    setBusy(false);
    if (res == null) return;
    if (!wrote(res)) return toast(t("web.writeNoop"));
    await reload();
    toast(t("mkt.autoSaved"), "ok");
  }

  return (
    <div className="flex flex-col gap-2 rounded-[14px] bg-field-2 p-3">
      <div className="flex flex-wrap items-start gap-3">
        <Switch
          checked={row.active}
          disabled={!canWrite || busy}
          onChange={(v) => void patch({ active: v })}
          label={t(`mkt.auto.${row.kind}` as Key)}
          hint={t(`mkt.auto.${row.kind}Hint` as Key)}
        />
        <span className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-muted">
            {row.last_run_at ? t("mkt.autoLastRun", { d: fullDateTime(row.last_run_at, lang) }) : t("mkt.autoNeverRun")}
          </span>
          {canWrite && (
            <Pill variant="ghost" size="xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "−" : t("mkt.edit")}
            </Pill>
          )}
        </span>
      </div>
      {open && (
        <div className="flex flex-col gap-3 border-t border-line pt-2.5">
          <Row cols={2}>
            <NumberField label={t("mkt.autoDelay")} value={config.delay_hours ?? null} suffix="h" onChange={(v) => setConfig({ ...config, delay_hours: v ?? undefined })} />
            <NumberField label={t("mkt.autoDiscount")} value={config.discount ?? null} suffix="%" onChange={(v) => setConfig({ ...config, discount: v ?? undefined })} />
          </Row>
          <Row cols={2}>
            <TextArea label={t("mkt.autoMsgDe")} rows={2} value={config.message_de ?? ""} onChange={(v) => setConfig({ ...config, message_de: v })} />
            <TextArea label={t("mkt.autoMsgEn")} rows={2} value={config.message_en ?? ""} onChange={(v) => setConfig({ ...config, message_en: v })} />
          </Row>
          <div className="flex gap-2">
            <Pill size="sm" onClick={() => void patch({ config: configToJson(config) })} disabled={busy}>
              {t("web.save")}
            </Pill>
            <Pill variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("web.cancel")}
            </Pill>
          </div>
        </div>
      )}
    </div>
  );
}
