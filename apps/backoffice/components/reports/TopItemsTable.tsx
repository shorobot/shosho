"use client";

import { Section } from "@/components/menu/Fields";
import { EmptyState } from "@/components/ui/States";
import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { useReports } from "@/lib/reportsStore";

export function TopItemsTable() {
  const { t, lang } = useI18n();
  const { topItems, range } = useReports();

  if (topItems.length === 0) {
    return (
      <Section title={t("rpt.topItems")}>
        <EmptyState icon="☰" title={t("state.noData.title")} body={t("state.noData.body", { r: `${range.from} – ${range.to}` })} />
      </Section>
    );
  }

  return (
    <Section title={t("rpt.topItems")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-line-2 text-left">
              {(["rpt.th.item", "rpt.th.qty", "rpt.th.revenue", "rpt.th.margin", "rpt.th.share"] as Key[]).map((k) => (
                <th key={k} className="label-caps px-3 py-2.5 font-medium">
                  {t(k)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topItems.map((r) => (
              <tr key={r.item_id} className="border-b border-line last:border-0 hover:bg-field-2">
                <td className="px-3 py-2.5 font-medium">{lang === "de" ? r.name_de || r.name : r.name}</td>
                <td className="px-3 py-2.5 text-ink-3">{r.qty}</td>
                <td className="whitespace-nowrap px-3 py-2.5 font-extrabold">{euro(r.revenue_cents, lang)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-3">{r.cost_cents == null ? "—" : euro(r.margin_cents, lang)}</td>
                <td className="px-3 py-2.5 text-ink-3">{t("kpi.pct", { n: r.share_pct.toFixed(1) })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
