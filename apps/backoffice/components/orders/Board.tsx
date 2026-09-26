"use client";

import { useMemo, useState } from "react";
import { BoardHeader } from "@/components/orders/BoardHeader";
import { DoneColumn, InProgressColumn, OnTheWayColumn, PreorderColumn, Section } from "@/components/orders/Columns";
import { Filters } from "@/components/orders/Filters";
import { KpiStrip } from "@/components/orders/KpiStrip";
import { PhoneOrderDialog } from "@/components/orders/PhoneOrderDialog";
import { ConnectionBanner, PaymentFailedBanner } from "@/components/orders/Banners";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import { Pill } from "@/components/ui/Pill";
import { useI18n } from "@/lib/i18n";
import { applyFilters, groupOrders, inProgressStats, kpis, type Filter } from "@/lib/orders";
import { useOrders } from "@/lib/store";
import { euro } from "@/lib/money";
import { hhmm, scheduleLabel } from "@/lib/time";
import { Toasts } from "@/lib/toast";

export function Board() {
  const { t, lang } = useI18n();
  const { orders, loading, error, now, settings, staff, reload } = useOrders();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [phoneOpen, setPhoneOpen] = useState(false);

  const filtered = useMemo(() => applyFilters(orders, query, filter), [orders, query, filter]);
  const g = useMemo(() => groupOrders(filtered, now), [filtered, now]);
  const stats = inProgressStats(g.inProgress, now);
  const k = kpis(orders, now);
  const paused = Boolean(settings.kitchen.paused ?? settings.kitchenStatus.paused);
  const pausedBy = staff.find((s) => s.id === settings.kitchen.paused_by)?.name;
  const failed = orders.filter((o) => o.payment_status === "failed" && o.status !== "cancelled" && o.status !== "refunded");
  const nothing = g.inProgress.length + g.onTheWay.length + g.doneToday.length + g.preorders.length === 0;
  const filtering = query.trim() !== "" || filter !== "all";

  return (
    <div className="screen-in flex flex-col gap-4">
      <BoardHeader />
      <ConnectionBanner />
      {error && <ErrorState title={t("state.error.title")} body={t("error.load", { m: error })} actions={<Pill variant="alert" size="sm" onClick={() => void reload()}>{t("action.retry")}</Pill>} />}
      <KpiStrip orders={orders} />
      {paused && (
        <EmptyState
          icon="⏸"
          tint
          title={t("state.paused.title")}
          body={pausedBy && settings.kitchen.paused_at ? t("state.paused.body", { a: pausedBy, t: hhmm(settings.kitchen.paused_at) }) : t("state.paused.bodyShort")}
        />
      )}
      {failed.map((o) => (
        <PaymentFailedBanner key={o.id} order={o} />
      ))}
      <Filters query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} />

      {loading ? (
        <Spinner label={t("misc.loading")} />
      ) : nothing ? (
        filtering ? (
          <EmptyState
            icon="⌕"
            title={t("state.noMatch.title")}
            body={t("state.noMatch.body", { q: query || t(`filter.${filter}` as "filter.all") })}
            action={
              <Pill
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                {t("state.noMatch.cta")}
              </Pill>
            }
          />
        ) : (
          <EmptyState
            icon="◷"
            title={t("state.noOrders.title")}
            body={t("state.noOrders.bodyNoHours")}
            action={<Pill onClick={() => setPhoneOpen(true)}>{t("state.noOrders.cta")}</Pill>}
          />
        )
      ) : (
        <div className="flex flex-col gap-6">
          {g.inProgress.length > 0 && (
            <Section dot="#F26B21" title={t("col.inProgress")} count={g.inProgress.length} hint={t("col.newOverdue", { n: stats.newCount, o: stats.overdue })} expandable={false}>
              <InProgressColumn rows={g.inProgress} />
            </Section>
          )}
          {g.onTheWay.length > 0 && (
            <Section dot="#8FC4EE" title={t("col.onTheWay")} count={g.onTheWay.length} hint={k.avgDeliveryMin == null ? undefined : t("col.avgToday", { n: k.avgDeliveryMin })} expandable={false}>
              <OnTheWayColumn rows={g.onTheWay} />
            </Section>
          )}
          {g.doneToday.length > 0 && (
            <Section dot="#C7C1B8" title={t("col.doneToday")} count={g.doneToday.length} hint={t("col.doneSummary", { c: k.cancelled, r: euro(k.revenueCents, lang) })} expandable={false}>
              <DoneColumn rows={g.doneToday} />
            </Section>
          )}
          {g.preorders.length > 0 && (
            <Section
              dot="#2E86D6"
              title={t("col.preorders")}
              count={g.preorders.length}
              hint={g.preorders[0]?.scheduled_for ? t("col.nextAt", { t: scheduleLabel(g.preorders[0].scheduled_for, now, { tomorrow: t("misc.tomorrow") }) }) : undefined}
              expandable={false}
            >
              <PreorderColumn rows={g.preorders} />
            </Section>
          )}
        </div>
      )}

      <PhoneOrderDialog open={phoneOpen} onClose={() => setPhoneOpen(false)} />
      <Toasts />
    </div>
  );
}
