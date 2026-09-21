"use client";
import { useCart } from "@/lib/cart";

// DELIVERY / PICKUP — inset pill with a raised white knob (header + cart panel).
export function OrderTypeToggle({ className = "", stretch = false }: { className?: string; stretch?: boolean }) {
  const { state, setType } = useCart();
  const btn = (t: "delivery" | "pickup", label: string) => {
    const on = state.type === t;
    return (
      <button
        type="button"
        onClick={() => setType(t)}
        aria-pressed={on}
        className={`rounded-full px-[15px] py-[7px] text-[12px] font-medium leading-[1.3] tracking-[0.04em] uppercase transition-micro ${stretch ? "flex-1 text-center" : ""} ${
          on ? "bg-paper text-ink shadow-(--shadow-knob)" : "text-ink-2 hover:text-ink"
        }`}
      >
        {label}
      </button>
    );
  };
  return (
    <div className={`flex rounded-full bg-field p-1 shadow-(--shadow-inset-sm) ${className}`} role="group" aria-label="Delivery or pickup">
      {btn("delivery", "Delivery")}
      {btn("pickup", "Pickup")}
    </div>
  );
}
