"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { AllergyBanner, PaymentLine } from "@/components/orders/OrderCard";
import { CancelDialog } from "@/components/orders/CancelDialog";
import { DriverDialog } from "@/components/orders/DriverDialog";
import { RefundDialog } from "@/components/orders/RefundDialog";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { Bon } from "@/components/detail/Bon";
import { Timeline } from "@/components/detail/Timeline";
import { Badge } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { EmptyState, Spinner } from "@/components/ui/States";
import { useI18n, type Key } from "@/lib/i18n";
import { payMethodKey, payStatusKey, statusKey, statusTone } from "@/lib/labels";
import { euro, km } from "@/lib/money";
import { actionsFor, addressOf, eta, timerFor } from "@/lib/orders";
import { useOrders } from "@/lib/store";
import { ddmmHHmm, hhmm } from "@/lib/time";
import { Toasts } from "@/lib/toast";
import type { OptionSnapshot, Order } from "@/lib/types";

const ACTION_KEY: Record<string, Key> = {
  accept: "action.accept",
  reject: "action.reject",
  start: "action.start",
  ready: "action.markReady",
  hand_to_driver: "action.handToDriver",
  handed_out: "action.handedOut",
  delivered: "action.delivered",
  cancel: "action.cancel",
  refund: "action.refund",
};

export function OrderDetail({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { orders, me, staff, now, refetchOrder } = useOrders();
  const { run, busy } = useOrderAction();
  const [dialog, setDialog] = useState<null | "driver" | "cancel" | "refund">(null);
  const [nth, setNth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const order = orders.find((o) => o.id === id) ?? null;

  // The store holds today's orders; an older one is fetched on demand (and kept live by the same channel).
  useEffect(() => {
    let alive = true;
    void refetchOrder(id).then(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, refetchOrder]);

  // "14. Bestellung" via customer_stats (api-contracts §6.2/§6.4)
  useEffect(() => {
    if (!order?.customer_id) return;
    let alive = true;
    void supabase
      .from("customer_stats")
      .select("orders_count")
      .eq("customer_id", order.customer_id)
      .maybeSingle()
      .then(({ data }) => alive && setNth(data?.orders_count ?? null));
    return () => {
      alive = false;
    };
  }, [supabase, order?.customer_id]);

  if (!order) {
    return loading ? <Spinner label={t("misc.loading")} /> : <EmptyState icon="⌕" title={t("detail.notFound")} body={`#${id}`} action={<Pill variant="soft">{<Link href="/orders">{t("detail.back")}</Link>}</Pill>} />;
  }

  const a = addressOf(order);
  const timer = timerFor(order, now);
  const actions = actionsFor(order, me.role, me.id);
  const driver = staff.find((s) => s.id === order.driver_id);
  const at = eta(order);
  const working = busy === order.id;

  return (
    <div className="screen-in mx-auto flex max-w-[860px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/orders" className="text-[12px] font-extrabold text-muted hover:text-ink">
          {t("detail.back")}
        </Link>
        <h1 className="ml-1">#{order.number}</h1>
        <Badge tone={statusTone(order.status, timer.urgency)}>{t(statusKey(order.status))}</Badge>
        {order.type === "pickup" && <Badge tone="ink">{t("type.pickup.badge")}</Badge>}
        <span className="text-[12px] text-muted">{ddmmHHmm(order.created_at)} · {t("detail.channel", { c: t(`channel.${order.channel}` as Key) })}</span>
        <Pill variant="ghost" size="sm" className="ml-auto" onClick={() => window.print()}>
          ⎙ {t("action.print")}
        </Pill>
      </div>

      {order.allergy_note && <AllergyBanner note={order.allergy_note} big />}

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-sand text-[12px] font-extrabold text-ink-2">
          {order.contact_name.split(/\s+/).map((p) => p[0] ?? "").join("").slice(0, 2).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[14px] font-extrabold">
            {order.contact_name}
            <span className="ml-1.5 text-[12px] font-medium text-muted">{nth == null ? "" : nth <= 1 ? t("detail.firstOrder") : t("detail.nthOrder", { n: nth })}</span>
          </span>
          <a href={`tel:${order.contact_phone.replace(/\s+/g, "")}`} className="text-[12px] font-medium text-blue">
            {order.contact_phone}
          </a>
        </div>
        <span className="ml-auto text-[11px] font-extrabold text-muted">{t("detail.crmSoon")}</span>
      </div>

      <div className="card flex flex-col gap-2 p-4">
        <span className="label-caps">{order.type === "pickup" ? t("detail.pickup") : t("detail.delivery")}</span>
        {order.type === "delivery" ? (
          <>
            <span className="text-[14px] font-extrabold">
              {a.street}
              {a.postal_code ? `, ${a.postal_code} ${a.city ?? ""}` : ""}
            </span>
            <span className="text-[12px] text-ink-3">
              {[a.floor_apt, order.distance_km != null ? t("card.km", { n: km(order.distance_km, lang) }) : null, at ? t("detail.eta", { t: hhmm(at.toISOString()) }) : null].filter(Boolean).join(" · ")}
            </span>
          </>
        ) : (
          <span className="text-[14px] font-extrabold">{order.scheduled_for ? t("card.pickupAt", { t: ddmmHHmm(order.scheduled_for) }) : t("card.pickup")}</span>
        )}
        {order.scheduled_for && order.type === "delivery" && <span className="text-[12px] font-medium text-blue">{t("detail.scheduledFor", { t: ddmmHHmm(order.scheduled_for) })}</span>}
        {order.courier_comment && <span className="text-[12px] text-ink-3">{t("card.comment")}: {order.courier_comment}</span>}
        {order.comment_flags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {order.comment_flags.map((f) => (
              <span key={f} className="rounded-full bg-field px-3 py-1.5 text-[11px] font-extrabold text-ink-2">
                {t(`flag.${f}` as Key)}
              </span>
            ))}
          </div>
        )}
        {order.type === "delivery" && <span className="text-[12px] font-medium text-ink-2">{driver ? t("detail.driver", { n: driver.name }) : t("detail.driverNone")}</span>}
      </div>

      <div className="card flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between">
          <span className="label-caps">{t("detail.items")}</span>
          <span className="text-[11px] font-medium text-muted">{t("detail.itemsReadonly")}</span>
        </div>
        {order.order_items.map((i) => {
          const opts = (Array.isArray(i.options) ? (i.options as OptionSnapshot[]) : []).filter((o) => o?.option);
          return (
            <div key={i.id} className="flex gap-3 border-b border-line py-2 last:border-0">
              <span className="w-7 flex-none text-[12px] font-medium text-muted">{i.qty}×</span>
              <span className="min-w-0 flex-1 text-[13px] font-medium">
                {i.name}
                {opts.length > 0 && <span className="block text-[11px] text-orange">+ {opts.map((o) => o.option).join(", ")}</span>}
                {i.modified_by_operator && <span className="block text-[11px] text-muted">✎</span>}
              </span>
              <span className="whitespace-nowrap text-[13px] font-extrabold">{euro(i.line_total_cents, lang)}</span>
            </div>
          );
        })}
      </div>

      <div className="card flex flex-col gap-1.5 p-4 text-[13px]">
        <Row label={t("detail.subtotal")} value={euro(order.subtotal_cents, lang)} />
        {order.type === "delivery" && <Row label={t("detail.deliveryFee")} value={euro(order.delivery_fee_cents, lang)} />}
        {order.discount_cents > 0 && <Row label={order.promo_code ? t("detail.promo", { c: order.promo_code }) : t("detail.discount")} value={`−${euro(order.discount_cents, lang)}`} />}
        {order.tip_cents > 0 && <Row label={t("detail.tip")} value={euro(order.tip_cents, lang)} />}
        <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
          <span className="text-[14px] font-extrabold">{t("detail.total")}</span>
          <span className="text-[20px] font-extrabold">{euro(order.total_cents, lang)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted">{t("detail.vat", { v: euro(order.vat_cents, lang) })}</span>
          <PaymentLine order={order} />
        </div>
        <span className="text-[11px] text-muted">{t("detail.paymentRef", { s: t(payStatusKey(order.payment_status)), m: order.payment_ref || t(payMethodKey(order.payment_method)) })}</span>
        {order.cancel_reason && <span className="text-[11px] font-extrabold text-alert">{order.cancel_reason}</span>}
      </div>

      <div className="card p-4">
        <Timeline events={order.order_events} />
      </div>

      {actions.length > 0 && (
        <div className="sticky bottom-3 flex flex-wrap gap-2 rounded-full bg-paper/95 p-2 shadow-(--shadow-card) backdrop-blur">
          {actions.map((act) => (
            <Pill
              key={act.id}
              variant={act.primary ? "primary" : act.id === "cancel" || act.id === "refund" ? "soft" : "ink"}
              size="lg"
              className={act.primary ? "flex-1" : ""}
              disabled={working}
              onClick={() => (act.dialog ? setDialog(act.dialog) : void run(order, act.to))}
            >
              {t(ACTION_KEY[act.id] as Key)}
            </Pill>
          ))}
        </div>
      )}

      <Bon order={order as Order} />
      <DriverDialog order={order} open={dialog === "driver"} onClose={() => setDialog(null)} />
      <CancelDialog order={order} open={dialog === "cancel"} onClose={() => setDialog(null)} />
      <RefundDialog order={order} open={dialog === "refund"} onClose={() => setDialog(null)} />
      <Toasts />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-3">{label}</span>
      <span className="font-extrabold">{value}</span>
    </div>
  );
}
