"use client";

// Europe/Berlin calendar dates, both ends inclusive (api-contracts §6.10) — the same convention
// History.tsx's range filter uses, reused here rather than re-invented.
import { useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { useI18n } from "@/lib/i18n";
import { defaultRange } from "@/lib/reports";
import { useReports } from "@/lib/reportsStore";
import { dayKey } from "@/lib/time";

export function PeriodPicker() {
  const { t } = useI18n();
  const { range, setRange } = useReports();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const dirty = from !== range.from || to !== range.to;

  function preset(days: number) {
    const r = defaultRange(new Date(), days);
    setFrom(r.from);
    setTo(r.to);
    setRange(r);
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="label-caps">{t("rpt.from")}</span>
        <input type="date" className="field py-2" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-caps">{t("rpt.to")}</span>
        <input type="date" className="field py-2" value={to} min={from} max={dayKey(new Date())} onChange={(e) => setTo(e.target.value)} />
      </label>
      <Pill size="sm" variant={dirty ? "primary" : "soft"} onClick={() => setRange({ from, to })} disabled={!dirty}>
        {t("rpt.apply")}
      </Pill>
      <Pill size="sm" variant="ghost" onClick={() => preset(7)}>
        {t("rpt.preset7")}
      </Pill>
      <Pill size="sm" variant="ghost" onClick={() => preset(30)}>
        {t("rpt.preset30")}
      </Pill>
    </div>
  );
}
