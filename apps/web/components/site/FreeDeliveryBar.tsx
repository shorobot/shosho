"use client";
import { useCart, useCatalog } from "@/lib/cart";
import { euro } from "@/lib/money";

// "Add 9.60 € more for free delivery" — threshold from the quoted zone, else the site hint / zones.
export function freeDeliveryThreshold(quoteZone: { free_delivery_over_cents: number | null } | null | undefined, site: { free_delivery_hint_cents?: number } | null, zones: { free_delivery_over_cents: number | null }[]): number | null {
  if (quoteZone) return quoteZone.free_delivery_over_cents;
  if (site?.free_delivery_hint_cents) return site.free_delivery_hint_cents;
  const vals = zones.map((z) => z.free_delivery_over_cents).filter((v): v is number => v != null);
  return vals.length ? Math.min(...vals) : null;
}

export function FreeDeliveryBar() {
  const { state, quote } = useCart();
  const { settings, zones } = useCatalog();
  if (state.type !== "delivery") return null;
  const threshold = freeDeliveryThreshold(quote?.zone, settings.site, zones);
  if (threshold == null) return null;
  const subtotal = quote?.subtotal_cents ?? 0;
  const missing = Math.max(threshold - subtotal, 0);
  const pct = Math.min(100, Math.round((subtotal / threshold) * 100));
  const unlocked = missing === 0 && subtotal > 0;
  return (
    <div className="flex flex-col gap-2 rounded-[18px] bg-field-2 px-3.5 py-3 shadow-(--shadow-inset)">
      <div className="flex justify-between text-[12px] font-medium leading-[1.3] text-ink-2">
        <span>{unlocked ? "Free delivery unlocked" : `Add ${euro(missing)} more for free delivery`}</span>
        <span className="font-extrabold text-orange">{euro(subtotal)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-track shadow-[inset_1px_1px_3px_rgba(174,164,152,.35)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to free delivery">
        <div className={`h-1.5 rounded transition-[width] duration-(--duration-screen) ${unlocked ? "bg-orange" : "bg-progress"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
