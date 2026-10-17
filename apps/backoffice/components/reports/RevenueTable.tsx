"use client";

import { Section } from "@/components/menu/Fields";
import { EmptyState } from "@/components/ui/States";
import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { useReports } from "@/lib/reportsStore";
import { ddmm } from "@/lib/time";

/** Umsatz nach Tag (api-contracts §6.10). The full column set goes to the XLSX export; this table
 * shows the ones an operator actually scans day to day. */
export function RevenueTable() {
  const { t, lang } = useI18n();
  const { revenueByDay, range } = useReports();

  if (revenueByDay.length === 0) {
    return (
      <Section title={t("rpt.revenueByDay")}>
        <EmptyState icon="Σ" title={t("state.noData.title")} body={t("state.noData.body", { r: `${range.from} – ${range.to}` })} />
      </Section>
    );
  }

  const totals = revenueByDay.reduce(
    (a, r) => ({ orders: a.orders + r.orders_count, revenue: a.revenue + r.revenue_cents, delivery: a.delivery + r.delivery_revenue_cents, pickup: a.pickup + r.pickup_revenue_cents, cancelled: a.cancelled + r.cancelled_count }),
    { orders: 0, revenue: 0, delivery: 0, pickup: 0, cancelled: 0 },
  );

  return (
    <Section title={t("rpt.revenueByDay")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line-2 text-left">
              {(["rpt.th.day", "rpt.th.orders", "rpt.th.revenue", "rpt.th.delivery", "rpt.th.pickup", "rpt.th.cancelled"] as Key[]).map((k) => (
                <th key={k} className="label-caps px-3 py-2.5 font-medium">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {revenueByDay.map((r) => (
              <tr key={r.day} className="border-b border-line last:border-0 hover:bg-field-2">
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{ddmm(`${r.day}T12:00:00Z`)}</td>
                <td className="px-3 py-2.5">{r.orders_count}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-extrabold">{euro(r.revenue_cents, lang)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{euro(r.delivery_revenue_cents, lang)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{euro(r.pickup_revenue_cents, lang)}</td>
                <td className="px-3 py-2.5 text-ink-3">{r.cancelled_count}</td>
              </tr>
            ))}
            <tr className="bg-field-2 font-extrabold">
              <td className="px-3 py-2.5">Σ</td>
              <td className="px-3 py-2.5">{totals.orders}</td>
              <td className="whitespace-nowrap px-3 py-2.5">{euro(totals.revenue, lang)}</td>
              <td className="whitespace-nowrap px-3 py-2.5">{euro(totals.delivery, lang)}</td>
              <td className="whitespace-nowrap px-3 py-2.5">{euro(totals.pickup, lang)}</td>
              <td className="px-3 py-2.5">{totals.cancelled}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Section>
  );
}
