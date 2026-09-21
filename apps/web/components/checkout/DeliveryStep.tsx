"use client";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import { useCart, useCatalog } from "@/lib/cart";
import { upcomingSlots, berlinDateTime, berlinParts } from "@/lib/hours";
import { euro, euroShort } from "@/lib/money";
import { closedReason } from "@/lib/problems";
import type { CommentFlag, Quote } from "@/lib/types";
import { useState } from "react";

const FLAGS: { id: CommentFlag; label: string }[] = [
  { id: "leave_at_door", label: "Leave at the door" },
  { id: "dont_ring", label: "Don't ring the bell" },
  { id: "call_on_arrival", label: "Call on arrival" },
  { id: "no_wasabi", label: "No wasabi" },
];

export type DeliveryForm = { comment: string; flags: CommentFlag[] };

// Step 2 — Delivery vs Pickup cards (numbers from the two quotes), address (postal code → zone),
// courier comment + quick chips, WHEN: ASAP / next slots / pick a time.
export function DeliveryStep({ deliveryQuote, pickupQuote, form, onForm }: { deliveryQuote: Quote | null; pickupQuote: Quote | null; form: DeliveryForm; onForm: (f: DeliveryForm) => void }) {
  const { state, quote, setType, setAddress, setSchedule } = useCart();
  const { settings } = useCatalog();
  const [customTime, setCustomTime] = useState(false);
  const isDelivery = state.type === "delivery";
  const business = settings.business;

  const dz = deliveryQuote?.zone;
  const deliveryInfo = dz
    ? `${dz.promised_minutes} min · ${dz.free_delivery_over_cents != null ? `free over ${euroShort(dz.free_delivery_over_cents)}` : dz.fee_cents === 0 ? "free" : `${euro(dz.fee_cents)} fee`}`
    : state.address.postal_code
      ? "not in our delivery area"
      : "enter your postal code";
  const pct = pickupQuote && pickupQuote.subtotal_cents > 0 ? Math.round((pickupQuote.pickup_discount_cents / pickupQuote.subtotal_cents) * 100) : null;
  const pickupInfo = `${business?.address?.street ?? "Torstraße"}${pickupQuote?.promised_minutes != null ? ` · ready in ${pickupQuote.promised_minutes} min` : ""}${pct ? ` · −${pct}%` : ""}`;

  const outOfZone = isDelivery && quote?.problems.find((p) => p.code === "out_of_zone" && p.reason !== "postal_code_missing");
  const belowMin = isDelivery && quote?.problems.find((p) => p.code === "below_min_order");
  const closed = quote?.problems.find((p) => p.code === "closed");
  const slots = upcomingSlots(settings.opening_hours, { limit: 4 });
  const minLocal = (() => {
    const p = berlinParts(new Date(Date.now() + 20 * 60_000));
    return `${p.date}T${p.time}`;
  })();
  const maxLocal = `${berlinParts(new Date(Date.now() + 7 * 86_400_000)).date}T23:30`;

  const card = (on: boolean) =>
    `flex flex-col gap-1.5 rounded-[18px] p-[18px] text-left transition-micro ${on ? "border-2 border-orange bg-orange-tint" : "border border-line-3 bg-paper hover:border-muted"}`;

  return (
    <section id="step-2" className="card flex scroll-mt-[96px] flex-col gap-[18px] p-5 md:p-6">
      <h2 className="text-[22px] font-extrabold leading-[1.3]">How would you like it?</h2>
      <div className="grid grid-cols-2 gap-3.5" role="radiogroup" aria-label="Delivery or pickup">
        <button type="button" role="radio" aria-checked={isDelivery} className={card(isDelivery)} onClick={() => setType("delivery")}>
          <span className={`text-[16px] font-extrabold leading-[1.3] ${isDelivery ? "" : "text-ink-2"}`}>Delivery</span>
          <span className={`text-[13px] leading-[1.4] ${isDelivery ? "text-ink-3" : "text-muted"}`}>{deliveryInfo}</span>
        </button>
        <button type="button" role="radio" aria-checked={!isDelivery} className={card(!isDelivery)} onClick={() => setType("pickup")}>
          <span className={`text-[16px] font-extrabold leading-[1.3] ${!isDelivery ? "" : "text-ink-2"}`}>Pickup</span>
          <span className={`text-[13px] leading-[1.4] ${!isDelivery ? "text-ink-3" : "text-muted"}`}>{pickupInfo}</span>
        </button>
      </div>

      {isDelivery ? (
        <>
          <div className="grid gap-3.5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <label className="flex flex-col gap-[7px]">
              <span className="label-caps">Address</span>
              <input className="field" placeholder="Street and number" value={state.address.street} onChange={(e) => setAddress({ street: e.target.value })} autoComplete="street-address" required />
            </label>
            <label className="flex flex-col gap-[7px]">
              <span className="label-caps">Floor / Apt</span>
              <input className="field" placeholder="Optional" value={state.address.floor_apt} onChange={(e) => setAddress({ floor_apt: e.target.value })} autoComplete="address-line2" />
            </label>
          </div>
          <div className="grid gap-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className="flex flex-col gap-[7px]">
              <span className="label-caps">Postal code</span>
              <input className="field" placeholder="10119" inputMode="numeric" value={state.address.postal_code} onChange={(e) => setAddress({ postal_code: e.target.value })} autoComplete="postal-code" required />
            </label>
            <div className="flex flex-col gap-[7px]">
              <span className="label-caps">Zone</span>
              <div className="rounded-2xl bg-field-2 p-[15px] text-[13px] leading-[1.4] text-ink-2 shadow-(--shadow-inset)" aria-live="polite">
                {dz ? (
                  <>
                    <span className="font-extrabold text-ink">{dz.name}</span> · delivery {dz.fee_cents === 0 || (deliveryQuote && deliveryQuote.delivery_fee_cents === 0) ? <span className="font-extrabold text-blue">free</span> : euro(deliveryQuote?.delivery_fee_cents ?? dz.fee_cents)} · min. order {euroShort(dz.min_order_cents)} · about {dz.promised_minutes} min
                  </>
                ) : state.address.postal_code ? (
                  "We don't deliver to this postal code."
                ) : (
                  "Enter your postal code to see fee, minimum order and delivery time."
                )}
              </div>
            </div>
          </div>
          {outOfZone && (
            <EmptyState
              icon="◉"
              title="We don't deliver to this address"
              body={`${outOfZone.postal_code ?? state.address.postal_code} is outside our delivery zones. Pickup at ${business?.address?.street ?? "Torstraße"} is available${pct ? ` — with −${pct}%` : ""}.`}
              action={<Pill size="sm" onClick={() => setType("pickup")}>Switch to pickup</Pill>}
            />
          )}
          {belowMin && (
            <div className="rounded-2xl bg-sand px-4 py-3 text-[13px] leading-[1.4]" role="alert">
              <span className="font-extrabold">Minimum order for your zone is {euro(belowMin.min_order_cents)}.</span> Add {euro((belowMin.min_order_cents ?? 0) - (belowMin.subtotal_cents ?? 0))} more — or switch to pickup, which has no minimum.
            </div>
          )}
          <div className="flex flex-col gap-[7px]">
            <label className="flex flex-col gap-[7px]">
              <span className="label-caps">Comment for the courier</span>
              <textarea className="field min-h-[66px] resize-y font-normal" placeholder="Door code, which entrance, allergies…" value={form.comment} onChange={(e) => onForm({ ...form, comment: e.target.value })} maxLength={500} />
            </label>
            <div className="mt-0.5 flex flex-wrap gap-2" role="group" aria-label="Quick notes">
              {FLAGS.map((f) => {
                const on = form.flags.includes(f.id);
                return (
                  <Pill key={f.id} size="xs" variant={on ? "selected" : "outline"} aria-pressed={on} onClick={() => onForm({ ...form, flags: on ? form.flags.filter((x) => x !== f.id) : [...form.flags, f.id] })} className="font-normal">
                    {f.label}
                  </Pill>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl bg-sand px-4 py-3.5 text-[13px] leading-[1.5] text-ink">
          <span className="font-extrabold">Pickup at {business?.address?.street ?? "our counter"}{business?.address?.postal_code ? `, ${business.address.postal_code} ${business.address.city ?? ""}` : ""}.</span>{" "}
          {pickupQuote?.promised_minutes != null ? `Ready in about ${pickupQuote.promised_minutes} minutes` : "We'll tell you when it's ready"}
          {pickupQuote && pickupQuote.pickup_discount_cents > 0 ? ` — you save ${euro(pickupQuote.pickup_discount_cents)}.` : "."}
          <label className="mt-3 flex flex-col gap-[7px]">
            <span className="label-caps">Note for the kitchen</span>
            <textarea className="field min-h-[56px] resize-y bg-paper font-normal" placeholder="Allergies, no wasabi…" value={form.comment} onChange={(e) => onForm({ ...form, comment: e.target.value })} maxLength={500} />
          </label>
        </div>
      )}

      <div id="when" className="flex scroll-mt-[96px] flex-col gap-[9px]">
        <span className="label-caps">When</span>
        <div className="flex flex-wrap gap-2.5" role="radiogroup" aria-label="When">
          <Pill size="sm" variant={!state.scheduled_for && !customTime ? "selected" : "outline"} role="radio" aria-checked={!state.scheduled_for && !customTime} onClick={() => { setCustomTime(false); setSchedule(null); }} className="px-[19px] py-2.5">
            As soon as possible
          </Pill>
          {slots.map((s) => (
            <Pill key={s.iso} size="sm" variant={state.scheduled_for === s.iso ? "selected" : "outline"} role="radio" aria-checked={state.scheduled_for === s.iso} onClick={() => { setCustomTime(false); setSchedule(s.iso); }} className="px-5 py-[11px]">
              {s.label}
            </Pill>
          ))}
          <Pill size="sm" variant={customTime ? "selected" : "outline"} role="radio" aria-checked={customTime} onClick={() => setCustomTime(true)} className="px-5 py-[11px]">
            Pick a time
          </Pill>
        </div>
        {customTime && (
          <label className="flex flex-col gap-[7px] sm:max-w-[320px]">
            <span className="text-[12px] text-muted">Up to 7 days ahead, inside opening hours (Berlin time)</span>
            <input
              type="datetime-local"
              className="field"
              min={minLocal}
              max={maxLocal}
              step={900}
              defaultValue={state.scheduled_for ? (() => { const p = berlinParts(new Date(state.scheduled_for)); return `${p.date}T${p.time}`; })() : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return setSchedule(null);
                const [d, t] = v.split("T") as [string, string];
                import("@/lib/hours").then(({ berlinToUtc }) => setSchedule(berlinToUtc(d, t.slice(0, 5)).toISOString()));
              }}
            />
          </label>
        )}
        {state.scheduled_for && !closed && <span className="text-[12px] text-ink-2">Pre-order for <span className="font-extrabold">{berlinDateTime(state.scheduled_for)}</span>.</span>}
        {closed && (
          <div className="rounded-2xl bg-sand px-4 py-3 text-[13px] leading-[1.4]" role="alert">
            <span className="font-extrabold">{closedReason(closed.reason).title}.</span> {closedReason(closed.reason).body}
          </div>
        )}
      </div>
    </section>
  );
}
