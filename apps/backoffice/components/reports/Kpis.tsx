"use client";

// The KPI row, aggregated client-side from report_revenue_by_day — same "value | unavailable"
// convention as BO · Marketing's Kpis.tsx (lib/marketing.ts), reused here as lib/reports.ts's Report.
import type { ReactNode } from "react";
import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { isAvailable, topLineKpis, type Report } from "@/lib/reports";
import { useReports } from "@/lib/reportsStore";

function Tile({ label, kpi, format }: { label: ReactNode; kpi: Report; format: (v: number) => string }) {
  const { t } = useI18n();
  const ok = isAvailable(kpi);
  return (
    <div className="card flex flex-col gap-1 rounded-[18px] p-4">
      <span className="label-caps">{label}</span>
      <span className={`text-[22px] font-extrabold leading-[1.15] ${ok ? "" : "text-muted"}`}>{ok ? format(kpi.value) : "—"}</span>
      {!ok && <span className="text-[11px] leading-[1.45] text-muted">{t(`rpt.reason.${kpi.unavailable}` as Key)}</span>}
    </div>
  );
}

export function Kpis() {
  const { t, lang } = useI18n();
  const { revenueByDay } = useReports();
  const k = topLineKpis(revenueByDay);
  const pct = (v: number) => t("kpi.pct", { n: v.toFixed(1).replace(".", lang === "de" ? "," : ".") });

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label={t("rpt.kpiOrders")} kpi={k.orders} format={(v) => String(v)} />
      <Tile label={t("rpt.kpiRevenue")} kpi={k.revenue} format={(v) => euro(v, lang)} />
      <Tile label={t("rpt.kpiAvgTicket")} kpi={k.avgTicket} format={(v) => euro(v, lang)} />
      <Tile label={t("rpt.kpiCancelled")} kpi={k.cancelledPct} format={pct} />
    </div>
  );
}
