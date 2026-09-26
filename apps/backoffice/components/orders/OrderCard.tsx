"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { CancelDialog } from "@/components/orders/CancelDialog";
import { DriverDialog } from "@/components/orders/DriverDialog";
import { RefundDialog } from "@/components/orders/RefundDialog";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { useI18n, type Key } from "@/lib/i18n";
import { cardEdge, isCashUnpaid, payMethodKey, statusKey, statusTone } from "@/lib/labels";
import { euro, km } from "@/lib/money";
import { actionsFor, addressOf, timerFor, type Action } from "@/lib/orders";
import { useOrders } from "@/lib/store";
import { elapsedLabel, hhmm, scheduleLabel } from "@/lib/time";
import type { OptionSnapshot, Order, OrderItemRow } from "@/lib/types";

const ACTION_KEY: Record<Action["id"], Key> = {
  accept: "action.accept",
  reject: "action.reject",
  start: "action.start",
  ready: "action.ready",
  hand_to_driver: "action.handToDriver",
  handed_out: "action.handedOut",
  delivered: "action.delivered",
  cancel: "action.cancel",
  refund: "action.refund",
};

export function OrderItems({ items, big = false }: { items: OrderItemRow[]; big?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 border-y border-line py-[9px] ${big ? "text-[15px]" : "text-[12px]"}`}>
      {items.map((it) => {
        const opts = (Array.isArray(it.options) ? (it.options as OptionSnapshot[]) : []).filter((o) => o && o.option);
        return (
          <div key={it.id} className="flex gap-2 font-medium leading-[1.4]">
            <span className="flex-none text-muted">{it.qty}×</span>
            <span className="min-w-0 flex-1">
              {it.name}
              {opts.length > 0 && <span className="block text-[11px] font-medium leading-[1.4] text-orange">+ {opts.map((o) => o.option).join(", ")}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function AllergyBanner({ note, big = false }: { note: string; big?: boolean }) {
  return (
    <div className={`rounded-[10px] bg-alert-tint px-3 py-2.5 font-extrabold leading-[1.4] text-alert ${big ? "text-[14px]" : "text-[11px]"}`} role="note">
      ⚠ {note}
    </div>
  );
}

export function PaymentLine({ order }: { order: Order }) {
  const { t, lang } = useI18n();
  if (order.payment_status === "failed") {
    return <span className="rounded-lg bg-alert-tint px-2.5 py-1.5 text-right text-[11px] font-extrabold leading-[1.35] text-alert">{t("card.failed")}</span>;
  }
  if (isCashUnpaid(order)) {
    return (
      <span className="rounded-lg bg-alert-tint px-2.5 py-1.5 text-right text-[11px] font-extrabold leading-[1.35] text-alert">
        {t(order.type === "pickup" ? "card.cashOnPickup" : "card.cashOnDelivery", { v: euro(order.total_cents, lang) })}
      </span>
    );
  }
  if (order.payment_status === "paid" || order.payment_status === "authorized") {
    return (
      <span className="text-right text-[11px] font-medium leading-[1.35] text-ok">
        {t(order.payment_status === "paid" ? "card.paid" : "card.authorized")} · {order.payment_ref || t(payMethodKey(order.payment_method))}
      </span>
    );
  }
  if (order.payment_status === "refunded") return <span className="text-right text-[11px] font-medium text-muted">{t("card.refunded")}</span>;
  return <span className="rounded-lg bg-alert-tint px-2.5 py-1.5 text-right text-[11px] font-extrabold leading-[1.35] text-alert">{t("card.open")} · {euro(order.total_cents, lang)}</span>;
}

function TimerLabel({ order }: { order: Order }) {
  const { t } = useI18n();
  const { now } = useOrders();
  const timer = timerFor(order, now);
  const color = timer.urgency === "critical" ? "text-alert" : timer.urgency === "warn" ? "text-amber" : order.status === "new" ? "text-orange" : order.status === "ready" || order.status === "out_for_delivery" ? "text-ok" : "text-blue";
  let text = "";
  if (timer.kind === "waiting") text = t("card.waiting", { t: elapsedLabel(timer.since, now) });
  else if (timer.kind === "start") text = t("card.startAt", { t: hhmm(timer.at) });
  else if (timer.kind === "cooking") text = `${t("card.timer", { a: timer.elapsedMin, b: timer.promisedMin })}${timer.overdue ? ` · ${t("card.overdue")}` : ""}`;
  else if (timer.kind === "standing") text = t("card.standing", { n: timer.min });
  else if (timer.kind === "eta") text = timer.at ? t("card.eta", { t: hhmm(timer.at.toISOString()) }) : "";
  else if (timer.kind === "done") text = hhmm(timer.at);
  return <span className={`ml-auto whitespace-nowrap text-[12px] font-extrabold ${color}`}>{text}</span>;
}

export function OrderCard({ order, big = false, showDriver = false }: { order: Order; big?: boolean; showDriver?: boolean }) {
  const { t, lang } = useI18n();
  const { me, now, staff } = useOrders();
  const { run, busy } = useOrderAction();
  const [dialog, setDialog] = useState<null | "driver" | "cancel" | "refund">(null);
  const timer = timerFor(order, now);
  const actions = actionsFor(order, me.role, me.id);
  const addr = addressOf(order);
  const working = busy === order.id;
  const driver = staff.find((s) => s.id === order.driver_id);

  const addressText =
    order.type === "pickup"
      ? order.scheduled_for
        ? t("card.pickupAt", { t: scheduleLabel(order.scheduled_for, now, { tomorrow: t("misc.tomorrow") }) })
        : t("card.pickup")
      : [addr.street, addr.floor_apt, order.distance_km != null ? t("card.km", { n: km(order.distance_km, lang) }) : null].filter(Boolean).join(" · ");

  return (
    <article className={`card flex flex-col gap-2.5 border-l-[5px] p-3.5 ${cardEdge(order.status, timer.urgency)} ${big ? "text-[14px]" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(order.status, timer.urgency) as Tone}>{t(statusKey(order.status))}</Badge>
        <Link href={`/orders/${order.id}`} className="text-[15px] font-extrabold hover:text-orange">
          #{order.number}
        </Link>
        {order.type === "pickup" && <Badge tone="ink">{t("type.pickup.badge")}</Badge>}
        {order.channel === "phone" && <Badge tone="sky">{t("channel.phone")}</Badge>}
        <TimerLabel order={order} />
      </div>

      {timer.kind === "cooking" && timer.promisedMin > 0 && (
        <div className="h-[5px] overflow-hidden rounded-[3px] bg-line-2">
          <div className={`h-[5px] rounded-[3px] ${timer.overdue ? "bg-alert" : timer.urgency === "warn" ? "bg-amber" : "bg-blue"}`} style={{ width: `${Math.round(timer.progress * 100)}%` }} />
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-extrabold">{order.contact_name}</span>
        <a href={`tel:${order.contact_phone.replace(/\s+/g, "")}`} className="text-[12px] font-medium text-blue">
          {order.contact_phone}
        </a>
        {addressText && <span className="text-[12px] leading-[1.45] text-ink-3">{addressText}</span>}
        {order.scheduled_for && order.type === "delivery" && (
          <span className="text-[12px] font-medium text-blue">{t("card.scheduled", { t: scheduleLabel(order.scheduled_for, now, { tomorrow: t("misc.tomorrow") }) })}</span>
        )}
        {showDriver && order.status === "out_for_delivery" && <span className="text-[12px] font-medium text-ink-3">{driver ? `${t("card.driver")}: ${driver.name}` : t("card.noDriver")}</span>}
      </div>

      {order.order_items.length > 0 && <OrderItems items={order.order_items} big={big} />}
      {order.allergy_note && <AllergyBanner note={order.allergy_note} big={big} />}
      {order.courier_comment && (
        <p className="rounded-[10px] bg-field px-3 py-2 text-[11px] leading-[1.45] text-ink-3">
          {t("card.comment")}: {order.courier_comment}
        </p>
      )}

      <div className="flex items-end justify-between gap-2.5">
        <span className="whitespace-nowrap text-[21px] font-extrabold leading-none">{euro(order.total_cents, lang)}</span>
        <PaymentLine order={order} />
      </div>

      {actions.length > 0 && (
        <div className="flex gap-2">
          {actions.map((a) => (
            <Pill
              key={a.id}
              variant={a.primary ? (order.status === "new" || order.status === "ready" ? "primary" : "ink") : "soft"}
              size={big ? "xl" : "md"}
              className={a.primary ? "flex-1" : ""}
              disabled={working}
              onClick={() => (a.dialog ? setDialog(a.dialog) : void run(order, a.to))}
            >
              {working && a.primary ? t("action.working") : a.id === "accept" ? t("action.acceptMin", { n: order.promised_minutes ?? 22 }) : t(ACTION_KEY[a.id])}
            </Pill>
          ))}
        </div>
      )}

      <DriverDialog order={order} open={dialog === "driver"} onClose={() => setDialog(null)} />
      <CancelDialog order={order} open={dialog === "cancel"} onClose={() => setDialog(null)} />
      <RefundDialog order={order} open={dialog === "refund"} onClose={() => setDialog(null)} />
    </article>
  );
}
