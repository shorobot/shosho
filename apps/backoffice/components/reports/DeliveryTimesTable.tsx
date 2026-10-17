"use client";

import { Section } from "@/components/menu/Fields";
import { EmptyState } from "@/components/ui/States";
import { useI18n, type Key } from "@/lib/i18n";
import { sortDeliveryTimes } from "@/lib/reports";
import { useReports } from "@/lib/reportsStore";

/** `zone_id = null` is the pickup/unzoned row (api-contracts §6.10) — sorted last, named "Abholung". */
export function DeliveryTimesTable() {
  const { t } = useI18n();
  const { deliveryTimes, range } = useReports();
  const rows = sortDeliveryTimes(deliveryTimes);

  if (rows.length === 0) {
    return (
      <Section title={t("rpt.deliveryTimes")}>
        <EmptyState icon="→" title={t("state.noData.title")} body={t("state.noData.body", { r: `${range.from} – ${range.to}` })} />
      </Section>
    );
  }

  return (
    <Section title={t("rpt.deliveryTimes")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line-2 text-left">
              {(["rpt.th.zone", "rpt.th.orders", "rpt.th.avgActual", "rpt.th.avgPromised", "rpt.th.delta", "rpt.th.overdue"] as Key[]).map((k) => (
                <th key={k} className="label-caps px-3 py-2.5 font-medium">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.zone_id ?? "pickup"} className="border-b border-line last:border-0 hover:bg-field-2">
                <td className="px-3 py-2.5 font-medium">{r.zone_id == null ? t("rpt.pickupZone") : r.zone_name}</td>
                <td className="px-3 py-2.5 text-ink-3">{r.orders_count}</td>
                <td className="whitespace-nowrap px-3 py-2.5">{Math.round(r.avg_actual_minutes)} min</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{Math.round(r.avg_promised_minutes)} min</td>
                <td className={`whitespace-nowrap px-3 py-2.5 font-extrabold ${r.delta_minutes > 0 ? "text-alert" : "text-ok"}`}>{r.delta_minutes > 0 ? "+" : ""}{Math.round(r.delta_minutes)} min</td>
                <td className="px-3 py-2.5 text-ink-3">{r.overdue_count} · {t("kpi.pct", { n: r.overdue_share_pct.toFixed(1) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
