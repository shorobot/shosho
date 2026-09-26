"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Count } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { OrderCard } from "@/components/orders/OrderCard";
import { useOrderAction } from "@/components/orders/useOrderAction";
import { useI18n } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { actionsFor, eta, isPaid } from "@/lib/orders";
import { useOrders } from "@/lib/store";
import { hhmm, minutesBetween, scheduleLabel } from "@/lib/time";
import type { Order } from "@/lib/types";

const COLLAPSED = 6;

export function Section({ dot, title, count, hint, children, expandable = true }: { dot: string; title: string; count: number; hint?: ReactNode; children: ReactNode; expandable?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2.5 px-0.5">
        <span className="h-[9px] w-[9px] flex-none rounded-full" style={{ background: dot }} />
        <h2 className="text-[13px] font-extrabold tracking-[0.06em]">{title}</h2>
        <Count tone={dot === "#F26B21" ? "orange" : dot === "#8FC4EE" ? "sky" : "muted"}>{count}</Count>
        {hint && <span className="text-[12px] font-medium text-muted">{hint}</span>}
        {expandable && count > COLLAPSED && (
          <button type="button" onClick={() => setOpen((v) => !v)} className="ml-auto whitespace-nowrap text-[11px] font-extrabold text-orange">
            {open ? t("col.showLess") : t("col.showAll")}
          </button>
        )}
      </header>
      <div data-expanded={open ? "true" : "false"} className="contents">
        {children}
      </div>
    </section>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(296px,1fr))] items-start gap-3">{children}</div>;
}

/** In Arbeit — the full cards with the transition buttons. */
export function InProgressColumn({ rows }: { rows: Order[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <>
      <CardGrid>
        {shown.map((o) => (
          <OrderCard key={o.id} order={o} />
        ))}
      </CardGrid>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="self-start text-[11px] font-extrabold text-orange">
          +{rows.length - shown.length}
        </button>
      )}
    </>
  );
}

/** Unterwegs — compact card: number, customer, ETA, driver + stops, Zugestellt. */
export function OnTheWayColumn({ rows }: { rows: Order[] }) {
  const { t, lang } = useI18n();
  const { me, staff, now } = useOrders();
  const { run, busy } = useOrderAction();
  return (
    <CardGrid>
      {rows.map((o) => {
        const driver = staff.find((s) => s.id === o.driver_id);
        const stops = rows.filter((r) => r.driver_id === o.driver_id).length;
        const at = eta(o);
        const late = at ? at.getTime() < now.getTime() : false;
        const can = actionsFor(o, me.role, me.id).some((a) => a.id === "delivered");
        return (
          <article key={o.id} className="card flex flex-col gap-2.5 border-l-[5px] border-ok p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/orders/${o.id}`} className="text-[15px] font-extrabold hover:text-orange">
                #{o.number}
              </Link>
              <span className="text-[13px] font-medium">{o.contact_name}</span>
              <span className={`ml-auto whitespace-nowrap text-[12px] font-extrabold ${late ? "text-alert" : "text-ok"}`}>{at ? t("card.eta", { t: hhmm(at.toISOString()) }) : ""}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-sky-tint text-[10px] font-extrabold text-ink-2">{(driver?.name ?? "—").slice(0, 2)}</span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[12px] font-extrabold">{driver?.name ?? t("card.noDriver")}</span>
                <span className="truncate text-[11px] text-muted">
                  {stops} · {(o.address as { street?: string } | null)?.street ?? ""}
                </span>
              </div>
              <span className="ml-auto whitespace-nowrap text-[13px] font-extrabold">{euro(o.total_cents, lang)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] font-medium ${isPaid(o.payment_status) ? "text-ok" : "text-alert"}`}>
                {isPaid(o.payment_status) ? t("card.paid") : t("card.cashOnDelivery", { v: euro(o.total_cents, lang) })}
              </span>
              {can && (
                <Pill variant="ink" size="sm" disabled={busy === o.id} onClick={() => void run(o, "delivered", { cash_received: o.payment_method === "cash" })}>
                  {t("action.delivered")}
                </Pill>
              )}
            </div>
          </article>
        );
      })}
    </CardGrid>
  );
}

/** Erledigt heute — small tiles: number, time, name, total, duration or "Abholung". */
export function DoneColumn({ rows }: { rows: Order[] }) {
  const { t, lang } = useI18n();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, COLLAPSED);
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
        {shown.map((o) => {
          const mins = o.completed_at ? minutesBetween(o.created_at, o.completed_at) : null;
          const done = o.status === "cancelled" || o.status === "refunded";
          return (
            <Link key={o.id} href={`/orders/${o.id}`} className="card flex flex-col gap-1.5 p-3.5 transition-micro hover:shadow-(--shadow-pill)">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-extrabold">#{o.number}</span>
                <span className="text-[11px] text-muted">{hhmm(o.completed_at ?? o.cancelled_at ?? o.updated_at)}</span>
              </div>
              <span className="truncate text-[12px] font-medium text-ink-2">{o.contact_name}</span>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-extrabold">{euro(o.total_cents, lang)}</span>
                <span className={`text-[11px] font-medium ${done ? "text-alert" : "text-muted"}`}>
                  {done ? t(o.status === "cancelled" ? "statusLong.cancelled" : "statusLong.refunded") : o.type === "pickup" ? t("type.pickup") : mins != null ? t("kpi.min", { n: mins }) : ""}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      {rows.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="self-start text-[11px] font-extrabold text-orange">
          {t("col.showAll")} (+{rows.length - shown.length})
        </button>
      )}
    </>
  );
}

/** Vorbestellungen — slot, number, type/zone, name, items summary, total, payment. */
export function PreorderColumn({ rows }: { rows: Order[] }) {
  const { t, lang } = useI18n();
  const { now } = useOrders();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
      {rows.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`} className="card flex flex-col gap-1.5 border-l-[5px] border-sky p-3.5 transition-micro hover:shadow-(--shadow-pill)">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-extrabold text-blue">{o.scheduled_for ? scheduleLabel(o.scheduled_for, now, { tomorrow: t("misc.tomorrow") }) : ""}</span>
            <span className="text-[13px] font-extrabold">#{o.number}</span>
            <span className="ml-auto text-[11px] text-muted">{o.type === "pickup" ? t("type.pickup") : t("type.delivery")}</span>
          </div>
          <span className="truncate text-[12px] font-medium text-ink-2">{o.contact_name}</span>
          <span className="line-clamp-2 text-[11px] text-muted">{o.order_items.map((i) => `${i.qty}× ${i.name}`).join(", ")}</span>
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-extrabold">{euro(o.total_cents, lang)}</span>
            <span className={`text-[11px] font-medium ${isPaid(o.payment_status) ? "text-ok" : "text-alert"}`}>{isPaid(o.payment_status) ? t("card.paid") : t("card.open")}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
