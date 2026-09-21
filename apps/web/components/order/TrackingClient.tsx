"use client";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { PillLink } from "@/components/ui/Pill";
import { Stone, DotGrid } from "@/components/ui/Decor";
import { getApi } from "@/lib/api";
import { useCatalog } from "@/lib/cart";
import { berlinDateTime, berlinTime } from "@/lib/hours";
import { euro } from "@/lib/money";
import type { OrderStatus, TrackedOrder } from "@/lib/types";

const FINAL: OrderStatus[] = ["delivered", "picked_up", "cancelled", "refunded"];
const POLL_MS = 15_000;

type Step = { key: string; label: string; at: string | null };

function timeline(o: TrackedOrder): Step[] {
  const at = (type: string) => o.events.find((e) => e.type === type)?.at ?? null;
  const base: Step[] = [
    { key: "created", label: "Order received", at: o.created_at },
    { key: "accepted", label: "Order accepted", at: o.accepted_at ?? at("accepted") },
    { key: "preparing", label: "Cooking", at: o.preparing_at ?? at("preparing") },
    { key: "ready", label: o.type === "delivery" ? "Packed and ready" : "Ready for pickup", at: o.ready_at ?? at("ready") },
  ];
  if (o.type === "delivery") {
    base.push({ key: "out", label: "Courier picked it up", at: o.out_at ?? at("handed_to_driver") });
    base.push({ key: "done", label: "Delivered", at: o.status === "delivered" ? o.completed_at ?? at("delivered") : null });
  } else {
    base.push({ key: "done", label: "Picked up", at: o.status === "picked_up" ? o.completed_at ?? at("picked_up") : null });
  }
  return base;
}

const PAY: Record<string, string> = { card: "Card", apple_pay: "Apple Pay", google_pay: "Google Pay", paypal: "PayPal", bitcoin: "Bitcoin", cash: "Cash on delivery" };

// /order/[token] — rpc('get_order_by_token'), polled every 15 s until a final status.
export function TrackingClient({ token }: { token: string }) {
  const { settings } = useCatalog();
  const [order, setOrder] = useState<TrackedOrder | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const api = await getApi();
      const o = await api.getOrderByToken(token);
      setOrder(o);
      setError(null);
      return o;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the order");
      return undefined;
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!order || FINAL.includes(order.status)) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [order, load]);

  if (order === undefined && !error) {
    return <div className="mx-auto max-w-[520px] px-4 py-16 text-center text-[13px] text-muted" role="status">Loading your order…</div>;
  }
  if (error && !order) {
    return (
      <div className="mx-auto max-w-[520px] px-4 py-16">
        <EmptyState icon="◔" title="We can't reach the kitchen right now" body={`${error}. Your order is safe — this page retries automatically.`} action={<PillLink href="/order" size="sm" variant="soft">My orders</PillLink>} />
      </div>
    );
  }
  if (!order) {
    return (
      <div className="mx-auto max-w-[520px] px-4 py-16">
        <EmptyState
          icon="◔"
          title="We can't find this order"
          body="The link may be incomplete or older than we keep tracking pages. Check the link from your confirmation, or call us with your name and phone number."
          action={<PillLink href="/order" size="sm">My orders</PillLink>}
          secondary={settings.business?.phone ? <PillLink href={`tel:${settings.business.phone}`} size="sm" variant="soft">Call {settings.business.phone}</PillLink> : undefined}
        />
      </div>
    );
  }

  const steps = timeline(order);
  const cancelled = order.status === "cancelled" || order.status === "refunded";
  const final = FINAL.includes(order.status);
  const doneIdx = cancelled ? -1 : steps.reduce((n, s, i) => (s.at ? i : n), -1);
  const headline = cancelled
    ? order.status === "refunded" ? "Refunded" : "Cancelled"
    : order.status === "delivered" ? "Delivered" : order.status === "picked_up" ? "Picked up"
    : order.scheduled_for ? "Scheduled for" : order.type === "delivery" ? "Arriving" : "Ready at";
  const etaText = cancelled ? berlinTime(order.cancelled_at) : final ? berlinTime(order.completed_at) : order.eta ? (order.scheduled_for ? berlinDateTime(order.eta) : berlinTime(order.eta)) : "soon";
  const addr = order.address;

  return (
    <div className="screen-in mx-auto flex max-w-[720px] flex-col gap-3.5 px-3 pt-[22px] md:px-[22px]">
      <div className="flex items-center gap-3">
        <PillLink href="/" variant="soft" size="xs" aria-label="Back to menu">‹</PillLink>
        <h1 className="flex-1 text-[17px] font-extrabold leading-[1.3]">Order #{order.number}</h1>
        {settings.business?.phone && <a href={`tel:${settings.business.phone}`} className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-paper text-[14px] shadow-(--shadow-pill)" aria-label="Call us">☏</a>}
      </div>

      <div className="relative h-[160px] overflow-hidden rounded-[22px] bg-[linear-gradient(140deg,#F3F0EA_0%,#E7E3DB_100%)]" aria-hidden>
        <Stone color="sky" className="left-[8%] top-[20%] h-[70px] w-[90px] opacity-70" />
        <Stone color="blush" className="right-[10%] top-[30%] h-[60px] w-[76px] opacity-80" />
        <DotGrid className="bottom-3 right-4" />
        <svg width="100%" height="160" viewBox="0 0 368 160" fill="none" className="absolute inset-0"><path d="M40 116 C 110 116, 150 86, 200 68 S 290 46, 324 40" stroke="#16192B" strokeWidth="2.5" strokeDasharray="7 7" opacity=".45" fill="none" /></svg>
        <span className="absolute left-[34px] top-[110px] h-3 w-3 rounded-full bg-blue" />
        <span className="absolute right-[44px] top-[34px] h-3 w-3 rounded-full bg-orange" />
      </div>

      <div className="card flex flex-col gap-1.5 p-[18px]" aria-live="polite">
        <span className="label-caps">{headline}</span>
        <span className="text-[32px] font-extrabold leading-[1.05] tracking-[-0.01em]">{etaText}</span>
        <span className="text-[13px] leading-[1.4] text-ink-3">
          {cancelled
            ? "If you have questions, call us — we're happy to help."
            : order.type === "delivery"
              ? `${addr?.street ?? ""}${addr?.floor_apt ? `, ${addr.floor_apt}` : ""}${addr?.postal_code ? ` · ${addr.postal_code}` : ""}`
              : `Pickup at ${settings.business?.address?.street ?? "our counter"}`}
          {order.promised_minutes != null && !final && !order.scheduled_for ? ` · about ${order.promised_minutes} min` : ""}
        </span>
      </div>

      <ol className="card flex flex-col p-[18px]" aria-label="Order status">
        {steps.map((s, i) => {
          const done = i <= doneIdx;
          const last = i === steps.length - 1;
          return (
            <li key={s.key} className="flex gap-3">
              <div className="flex flex-none flex-col items-center">
                <span className={`h-[22px] w-[22px] flex-none rounded-full text-center text-[11px] font-extrabold leading-[22px] ${done ? "bg-orange text-white" : "bg-track"}`} aria-hidden>{done ? "✓" : ""}</span>
                {!last && <span className={`min-h-[26px] w-0.5 flex-1 ${i < doneIdx ? "bg-orange" : "bg-track"}`} aria-hidden />}
              </div>
              <div className={`flex flex-col gap-0.5 ${last ? "pb-0" : "pb-3.5"}`}>
                <span className={`text-[14px] font-extrabold leading-[1.3] ${done ? "text-ink" : "text-muted-3"}`}>{s.label}{done && <span className="sr-only"> — done</span>}</span>
                <span className="text-[12px] leading-[1.3] text-muted">{s.at ? berlinTime(s.at) : last && order.eta && !cancelled ? `ETA ${berlinTime(order.eta)}` : ""}</span>
              </div>
            </li>
          );
        })}
        {cancelled && <li className="mt-2 rounded-2xl bg-sand px-3.5 py-2.5 text-[13px]"><span className="font-extrabold">This order was {order.status}</span> at {berlinTime(order.cancelled_at)}.</li>}
      </ol>

      <div className="card flex flex-col gap-2.5 p-4">
        <span className="label-caps">{order.items.reduce((n, i) => n + i.qty, 0)} items · {euro(order.total_cents)}</span>
        {order.items.map((it, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className={`h-[34px] w-[34px] flex-none rounded-[10px] ${i % 2 ? "photo-sky" : "photo-sand"}`} aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[13px] font-medium leading-[1.3]">{it.name}</span>
              {Array.isArray(it.options) && it.options.length > 0 && <span className="truncate text-[11px] text-muted">{(it.options as { option: string }[]).map((o) => o.option).join(" · ")}</span>}
            </span>
            <span className="text-[12px] font-medium text-muted">×{it.qty}</span>
            <span className="text-[13px] font-extrabold">{euro(it.line_total_cents)}</span>
          </div>
        ))}
        <div className="mt-1 flex flex-col gap-1 border-t border-line pt-2.5 text-[13px] text-ink-2">
          <div className="flex justify-between"><span>Subtotal</span><span>{euro(order.subtotal_cents)}</span></div>
          {order.discount_cents > 0 && <div className="flex justify-between"><span>Discount{order.promo_code ? ` (${order.promo_code})` : ""}</span><span className="text-orange">{euro(-order.discount_cents)}</span></div>}
          {order.type === "delivery" && <div className="flex justify-between"><span>Delivery</span>{order.delivery_fee_cents === 0 ? <span className="font-extrabold text-blue">FREE</span> : <span>{euro(order.delivery_fee_cents)}</span>}</div>}
          {order.tip_cents > 0 && <div className="flex justify-between"><span>Tip</span><span>{euro(order.tip_cents)}</span></div>}
          <div className="flex justify-between text-[17px] font-extrabold text-ink"><span>Total</span><span>{euro(order.total_cents)}</span></div>
          <span className="text-[11px] text-muted">{PAY[order.payment_method] ?? order.payment_method} · {order.payment_status === "paid" ? "paid" : "payment captured on delivery confirmation"}</span>
        </div>
      </div>
      {error && <p className="text-center text-[12px] text-muted" role="status">Connection hiccup — showing the last known status.</p>}
      {!final && <p className="text-center text-[12px] text-muted">This page refreshes every 15 seconds.</p>}
    </div>
  );
}
