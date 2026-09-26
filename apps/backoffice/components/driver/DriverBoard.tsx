"use client";

import { ConnectionBanner } from "@/components/orders/Banners";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { Badge } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { EmptyState, Spinner } from "@/components/ui/States";
import { useI18n, type Key } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { addressOf, cashToCollect, eta } from "@/lib/orders";
import { useOrders } from "@/lib/store";
import { hhmm } from "@/lib/time";
import { Toasts } from "@/lib/toast";
import type { Order, Staff } from "@/lib/types";

/** Fahrer (mobile-first, 375 px): own deliveries, maps link, tap-to-call, cash to collect, Zugestellt. */
export function DriverBoard({ me }: { me: Staff }) {
  const { t, lang } = useI18n();
  const { orders, loading } = useOrders();
  const mine = orders.filter((o) => o.driver_id === me.id && (o.status === "ready" || o.status === "out_for_delivery"));
  const out = mine.filter((o) => o.status === "out_for_delivery");
  const ready = mine.filter((o) => o.status === "ready");

  return (
    <div className="screen-in mx-auto flex max-w-[520px] flex-col gap-4">
      <h1>{t("driver.title.page")}</h1>
      <ConnectionBanner />
      {loading ? (
        <Spinner label={t("misc.loading")} />
      ) : mine.length === 0 ? (
        <EmptyState icon="◷" title={t("driver.empty")} body={t("driver.emptyBody")} />
      ) : (
        <>
          {out.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="label-caps">{t("driver.out")}</h2>
              {out.map((o) => (
                <DriverCard key={o.id} order={o} lang={lang} />
              ))}
            </section>
          )}
          {ready.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="label-caps">{t("driver.ready")}</h2>
              {ready.map((o) => (
                <DriverCard key={o.id} order={o} lang={lang} />
              ))}
            </section>
          )}
        </>
      )}
      <Toasts />
    </div>
  );
}

function DriverCard({ order, lang }: { order: Order; lang: "de" | "en" }) {
  const { t } = useI18n();
  const { run, busy } = useOrderAction();
  const a = addressOf(order);
  const address = [a.street, a.postal_code, a.city].filter(Boolean).join(", ");
  const cash = cashToCollect(order);
  const at = eta(order);
  const canDeliver = order.status === "out_for_delivery";

  return (
    <article className="card flex flex-col gap-3 border-l-[5px] border-ok p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={order.status === "ready" ? "ok" : "blue"}>{t(`status.${order.status}` as Key)}</Badge>
        <span className="text-[16px] font-extrabold">#{order.number}</span>
        {at && <span className="ml-auto text-[13px] font-extrabold text-ok">{t("card.eta", { t: hhmm(at.toISOString()) })}</span>}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-extrabold">{order.contact_name}</span>
        <span className="text-[14px] leading-[1.45] text-ink-2">{address || t("card.pickup")}</span>
        {a.floor_apt && <span className="text-[13px] text-ink-3">{a.floor_apt}</span>}
        {order.courier_comment && <span className="text-[13px] text-ink-3">{t("card.comment")}: {order.courier_comment}</span>}
      </div>
      {order.comment_flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {order.comment_flags.map((f) => (
            <span key={f} className="rounded-full bg-field px-3 py-1.5 text-[11px] font-extrabold text-ink-2">
              {t(`flag.${f}` as Key)}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={`tel:${order.contact_phone.replace(/\s+/g, "")}`} className="rounded-full bg-field px-4 py-3 text-[13px] font-extrabold text-ink-2">
          ☏ {order.contact_phone}
        </a>
        {address && (
          <a href={`https://maps.google.com/?q=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" className="rounded-full bg-field px-4 py-3 text-[13px] font-extrabold text-ink-2">
            ◉ {t("action.map")}
          </a>
        )}
      </div>
      <div className={`rounded-[12px] px-3.5 py-2.5 text-[14px] font-extrabold ${cash ? "bg-alert-tint text-alert" : "bg-ok-tint text-ok"}`}>
        {cash ? t("driver.collect", { v: euro(cash, lang) }) : t("driver.paidAlready")}
      </div>
      {canDeliver && (
        <Pill size="xl" className="w-full" disabled={busy === order.id} onClick={() => void run(order, "delivered", { cash_received: order.payment_method === "cash" })}>
          {cash ? t("driver.deliveredCash") : t("action.delivered")}
        </Pill>
      )}
    </article>
  );
}
