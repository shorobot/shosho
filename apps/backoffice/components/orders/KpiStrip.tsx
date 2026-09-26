"use client";

import { useI18n } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { kpis } from "@/lib/orders";
import { useOrders } from "@/lib/store";
import type { Order } from "@/lib/types";

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card flex flex-col gap-1.5 p-4">
      <span className="label-caps">{label}</span>
      <span className="whitespace-nowrap text-[24px] font-extrabold leading-[1.1]">{value}</span>
      <span className="text-[11px] font-medium text-muted">{hint}</span>
    </div>
  );
}

/** Today's KPIs, computed client-side from the loaded orders (api-contracts §6.1). */
export function KpiStrip({ orders }: { orders: Order[] }) {
  const { t, lang } = useI18n();
  const { now } = useOrders();
  const k = kpis(orders, now);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi label={t("kpi.orders")} value={String(k.orders)} hint={k.deliveredCount ? t("kpi.deliveredCount", { n: k.deliveredCount }) : t("kpi.none")} />
      <Kpi label={t("kpi.revenue")} value={euro(k.revenueCents, lang)} hint={k.avgTicketCents == null ? t("kpi.none") : t("kpi.avgTicket", { v: euro(k.avgTicketCents, lang) })} />
      <Kpi label={t("kpi.avgDelivery")} value={k.avgDeliveryMin == null ? t("kpi.none") : t("kpi.min", { n: k.avgDeliveryMin })} hint={t("kpi.deliveredCount", { n: k.deliveredCount })} />
      <Kpi label={t("kpi.cancelled")} value={String(k.cancelled)} hint={k.cancelledPct == null ? t("kpi.none") : t("kpi.pct", { n: String(k.cancelledPct).replace(".", lang === "de" ? "," : ".") })} />
    </div>
  );
}
