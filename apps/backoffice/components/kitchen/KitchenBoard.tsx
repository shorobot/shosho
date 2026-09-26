"use client";

import { useMemo } from "react";
import { ConnectionBanner } from "@/components/orders/Banners";
import { OrderCard } from "@/components/orders/OrderCard";
import { Count } from "@/components/ui/Badge";
import { EmptyState, Spinner } from "@/components/ui/States";
import { useI18n } from "@/lib/i18n";
import { useOrders } from "@/lib/store";
import { Toasts } from "@/lib/toast";
import type { Order, OrderStatus } from "@/lib/types";

const COLUMNS: { status: OrderStatus; title: "kitchen.queue" | "kitchen.cooking" | "kitchen.ready"; dot: string }[] = [
  { status: "accepted", title: "kitchen.queue", dot: "#2E86D6" },
  { status: "preparing", title: "kitchen.cooking", dot: "#F26B21" },
  { status: "ready", title: "kitchen.ready", dot: "#3E9B5F" },
];

/** Küche: only ANGENOMMEN / IN ZUBEREITUNG / FERTIG, big touch targets, allergy banners prominent. */
export function KitchenBoard() {
  const { t } = useI18n();
  const { orders, loading, now } = useOrders();

  const byStatus = useMemo(() => {
    const m = new Map<OrderStatus, Order[]>();
    for (const c of COLUMNS) m.set(c.status, []);
    for (const o of orders) {
      const list = m.get(o.status);
      if (list) list.push(o);
    }
    for (const [, list] of m) list.sort((a, b) => (a.preparing_at ?? a.accepted_at ?? a.created_at).localeCompare(b.preparing_at ?? b.accepted_at ?? b.created_at));
    return m;
  }, [orders]);

  const total = COLUMNS.reduce((n, c) => n + (byStatus.get(c.status)?.length ?? 0), 0);

  return (
    <div className="screen-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1>{t("kitchen.title")}</h1>
        <span className="text-[13px] font-medium text-muted">{now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}</span>
      </div>
      <ConnectionBanner />
      {loading ? (
        <Spinner label={t("misc.loading")} />
      ) : total === 0 ? (
        <EmptyState icon="◷" title={t("kitchen.empty")} body={t("kitchen.emptyBody")} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {COLUMNS.map((c) => {
            const rows = byStatus.get(c.status) ?? [];
            return (
              <section key={c.status} className="flex flex-col gap-3">
                <header className="flex items-center gap-2.5">
                  <span className="h-[9px] w-[9px] rounded-full" style={{ background: c.dot }} />
                  <h2 className="text-[14px] font-extrabold tracking-[0.06em]">{t(c.title)}</h2>
                  <Count>{rows.length}</Count>
                </header>
                <div className="flex flex-col gap-3">
                  {rows.map((o) => (
                    <OrderCard key={o.id} order={o} big />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <Toasts />
    </div>
  );
}
