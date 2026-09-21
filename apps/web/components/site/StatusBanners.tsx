"use client";
import Link from "next/link";
import { useCart, useCatalog } from "@/lib/cart";
import { isOpenAt, nextOpening } from "@/lib/hours";
import { closedReason } from "@/lib/problems";

/** Ordering is disabled while the kitchen is paused ("sold out today"). */
export function useOrderingState() {
  const { settings, online } = useCatalog();
  const paused = Boolean(settings.kitchen_status?.paused);
  const open = isOpenAt(settings.opening_hours);
  return { paused, open, online, canOrder: online && !paused };
}

// Kitchen paused → "sold out today"; outside hours → "pre-orders only"; quote `closed` reasons.
export function StatusBanners({ compact = false }: { compact?: boolean }) {
  const { paused, open } = useOrderingState();
  const { settings } = useCatalog();
  const { quote, state } = useCart();
  const closed = quote?.problems.find((p) => p.code === "closed");
  const next = nextOpening(settings.opening_hours);
  const pad = compact ? "px-3.5 py-2.5" : "px-4 py-3";

  if (paused) {
    return (
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-ink text-cream ${pad}`} role="status">
        <span className="text-[13px] leading-[1.4]">
          <span className="font-extrabold">Sold out today.</span> The kitchen has paused new orders — we&rsquo;ll be back {next ? (next.inDays === 0 ? "later today" : next.inDays === 1 ? `tomorrow at ${next.time}` : `in ${next.inDays} days`) : "soon"}.
        </span>
      </div>
    );
  }
  if (!open || (closed && !state.scheduled_for)) {
    const c = closedReason(closed?.reason ?? "outside_hours");
    const when = next ? (next.inDays === 0 ? `today at ${next.time}` : next.inDays === 1 ? `tomorrow at ${next.time}` : `in ${next.inDays} days at ${next.time}`) : null;
    return (
      <div className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-sand text-ink ${pad}`} role="status">
        <span className="text-[13px] leading-[1.4]">
          <span className="font-extrabold">{c.title}.</span> {when ? `The kitchen opens ${when}. ` : ""}Pre-orders only — pick a time at checkout.
        </span>
        <Link href="/checkout#when" className="text-[12px] font-extrabold text-orange">Pre-order →</Link>
      </div>
    );
  }
  if (closed && state.scheduled_for) {
    const c = closedReason(closed.reason);
    return (
      <div className={`rounded-2xl bg-sand text-[13px] leading-[1.4] text-ink ${pad}`} role="alert">
        <span className="font-extrabold">{c.title}.</span> {c.body}
      </div>
    );
  }
  return null;
}
