"use client";

// The four KPI tiles at the top of BO · Marketing (boot task 9).
//
// Three of them come from `orders` (promo revenue, codes redeemed, discount rate). The fourth — push
// open rate — has NO source: `campaigns.stats` is only ever written by a sender and there is none,
// so it renders as "not measurable" with the reason rather than as 0 %. A zero there would read as
// "nobody opens our pushes", which is a claim about the marketing; the truth is that nothing has
// ever been sent.
import type { ReactNode } from "react";
import { useI18n, type Key } from "@/lib/i18n";
import { codesRedeemed, discountRate, isAvailable, promoRevenue, pushOpenRate, type Kpi } from "@/lib/marketing";
import { KPI_WINDOW_DAYS, useMarketing } from "@/lib/marketingStore";
import { euro } from "@/lib/money";

function Tile({ label, kpi, hint, format }: { label: ReactNode; kpi: Kpi; hint?: ReactNode; format: (v: number) => string }) {
  const { t } = useI18n();
  const ok = isAvailable(kpi);
  return (
    <div className="card flex flex-col gap-1 rounded-[18px] p-4">
      <span className="label-caps">{label}</span>
      <span className={`text-[22px] font-extrabold leading-[1.15] ${ok ? "" : "text-muted"}`}>{ok ? format(kpi.value) : "—"}</span>
      <span className="text-[11px] leading-[1.45] text-muted">{ok ? hint : t(`mkt.reason.${kpi.unavailable}` as Key)}</span>
      {!ok && <span className="label-caps text-orange-ink">{t("mkt.unavailable")}</span>}
    </div>
  );
}

export function Kpis() {
  const { t, lang } = useI18n();
  const { orders, campaigns, from, to } = useMarketing();
  const window = t("mkt.window", { n: KPI_WINDOW_DAYS });
  const pct = (v: number) => t("kpi.pct", { n: v.toFixed(1).replace(".", lang === "de" ? "," : ".") });

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label={t("mkt.kpiPromoRevenue")} kpi={promoRevenue(orders, from, to)} hint={window} format={(v) => euro(v, lang)} />
      <Tile label={t("mkt.kpiCodes")} kpi={codesRedeemed(orders, from, to)} hint={window} format={(v) => String(v)} />
      <Tile label={t("mkt.kpiDiscountRate")} kpi={discountRate(orders, from, to)} hint={t("mkt.kpiDiscountTarget")} format={pct} />
      <Tile label={t("mkt.kpiPushOpen")} kpi={pushOpenRate(campaigns)} hint={t("mkt.kpiPushOpenHint")} format={pct} />
    </div>
  );
}
