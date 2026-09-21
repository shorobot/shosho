"use client";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cart";
import { Pill } from "@/components/ui/Pill";

// Header address: "◉ Torstraße 128, 10119" — click opens a small form. The postal code drives the zone
// (resolved by quote_order); the street is stored for checkout.
export function AddressButton({ className = "" }: { className?: string }) {
  const { state, setAddress } = useCart();
  const [open, setOpen] = useState(false);
  const [street, setStreet] = useState(state.address.street);
  const [postal, setPostal] = useState(state.address.postal_code);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setStreet(state.address.street);
    setPostal(state.address.postal_code);
  }, [state.address.street, state.address.postal_code]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label = state.address.street
    ? `${state.address.street}${state.address.postal_code ? `, ${state.address.postal_code}` : ""}`
    : state.address.postal_code
      ? `${state.address.postal_code} Berlin`
      : state.type === "pickup"
        ? "Pickup · Torstraße"
        : "Add delivery address";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex max-w-[240px] items-center gap-[7px] px-1.5 text-[13px] font-medium leading-[1.3] text-ink-2 transition-micro hover:text-ink"
      >
        <span className="text-orange" aria-hidden>◉</span>
        <span className="truncate">{label}</span>
      </button>
      {open && (
        <form
          className="absolute right-0 top-[calc(100%+10px)] z-40 flex w-[300px] flex-col gap-2.5 rounded-[20px] bg-paper p-4 shadow-(--shadow-card-lg)"
          onSubmit={(e) => {
            e.preventDefault();
            setAddress({ street: street.trim(), postal_code: postal.trim() });
            setOpen(false);
          }}
        >
          <span className="label-caps">Deliver to</span>
          <input className="field" placeholder="Street and number" value={street} onChange={(e) => setStreet(e.target.value)} autoComplete="street-address" />
          <input className="field" placeholder="Postal code" inputMode="numeric" value={postal} onChange={(e) => setPostal(e.target.value)} autoComplete="postal-code" />
          <Pill type="submit" size="sm">Save address</Pill>
        </form>
      )}
    </div>
  );
}
