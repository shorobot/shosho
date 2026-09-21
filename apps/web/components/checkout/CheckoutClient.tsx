"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CartLines, Totals } from "@/components/site/CartLines";
import { FreeDeliveryBar } from "@/components/site/FreeDeliveryBar";
import { PromoField } from "@/components/site/PromoField";
import { StatusBanners, useOrderingState } from "@/components/site/StatusBanners";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill, PillLink } from "@/components/ui/Pill";
import { getApi } from "@/lib/api";
import { rememberTracking, useCart, useCatalog } from "@/lib/cart";
import { euro } from "@/lib/money";
import { fieldLabel, problemSummary } from "@/lib/problems";
import { OrderRejectedError, type PaymentMethod, type Problem } from "@/lib/types";
import { DeliveryStep, type DeliveryForm } from "./DeliveryStep";
import { Stepper } from "./Stepper";
import { useAltQuote } from "./useAltQuote";

const PAY_LABEL: Record<PaymentMethod, string> = {
  card: "Card · Visa / MC",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  paypal: "PayPal",
  bitcoin: "Bitcoin",
  cash: "Cash on delivery",
};
const PAY_ORDER: PaymentMethod[] = ["card", "apple_pay", "google_pay", "paypal", "bitcoin", "cash"];

const phoneOk = (p: string) => p.replace(/\D/g, "").length >= 7;

// Checkout — the three steps on one page (CART → DELIVERY → PAYMENT) with a sticky summary.
// Place order → rpc('place_order'); the server re-quotes, rejects with problems, or returns the tracking token.
export function CheckoutClient() {
  const router = useRouter();
  const cart = useCart();
  const { settings, online } = useCatalog();
  const { canOrder, paused } = useOrderingState();
  const { state, quote, quoting, hydrated } = cart;
  const alt = useAltQuote(state.type === "delivery" ? "pickup" : "delivery");
  const deliveryQuote = state.type === "delivery" ? quote : alt;
  const pickupQuote = state.type === "pickup" ? quote : alt;

  const [form, setForm] = useState<DeliveryForm>({ comment: "", flags: [] });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejected, setRejected] = useState<Problem[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const methods = useMemo(() => {
    const enabled = settings.payments_enabled?.methods ?? [];
    return PAY_ORDER.filter((m) => enabled.includes(m));
  }, [settings.payments_enabled]);
  useEffect(() => {
    if (!method && methods[0]) setMethod(methods[0]);
  }, [methods, method]);

  // first-order promos are checked against the phone → re-quote once a phone is known
  useEffect(() => {
    if (state.promo_code && phoneOk(phone)) {
      const t = setTimeout(() => void cart.requote({ contact: { phone } }), 500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, state.promo_code]);

  const empty = hydrated && state.lines.length === 0;
  const cartOk = state.lines.length > 0;
  const deliveryOk = state.type === "pickup" || (state.address.street.trim().length > 2 && state.address.postal_code.trim().length >= 4);
  const contactOk = name.trim().length > 1 && phoneOk(phone);
  // an invalid promo does not block (the server ignores it); everything else does
  const blocking = (quote?.problems ?? []).filter((p) => p.code !== "promo_invalid");
  const ready = cartOk && deliveryOk && contactOk && Boolean(method) && Boolean(quote) && blocking.length === 0 && !quoting && canOrder;
  const done = cartOk ? (deliveryOk && contactOk ? 2 : 1) : 0;
  const current = Math.min(done + 1, 3);

  const submit = async () => {
    if (!ready || !method) return;
    setSubmitting(true);
    setRejected(null);
    setFailure(null);
    try {
      const api = await getApi();
      const res = await api.placeOrder({
        type: state.type,
        items: state.lines.map((l) => ({ item_id: l.item_id, qty: l.qty, option_ids: l.option_ids })),
        promo_code: state.promo_code || undefined,
        scheduled_for: state.scheduled_for,
        tip_cents: state.tip_cents || undefined,
        contact: { name: name.trim(), phone: phone.trim() },
        address: state.type === "delivery" ? { street: state.address.street.trim(), floor_apt: state.address.floor_apt.trim() || undefined, postal_code: state.address.postal_code.trim(), city: state.address.city || "Berlin" } : undefined,
        courier_comment: form.comment.trim() || undefined,
        comment_flags: state.type === "delivery" ? form.flags : undefined,
        payment_method: method,
        // v1: no payment provider — every method submits as pending; captured on delivery confirmation.
        payment_status: "pending",
      });
      rememberTracking(res.tracking_token, res.number);
      cart.clear();
      router.push(`/order/${res.tracking_token}`);
    } catch (e) {
      if (e instanceof OrderRejectedError) {
        setRejected(e.problems);
        void cart.requote();
      } else {
        setFailure(e instanceof Error ? e.message : "Something went wrong");
      }
      setSubmitting(false);
    }
  };

  if (!online) {
    return (
      <div className="mx-auto max-w-[520px] px-4 py-16">
        <EmptyState icon="☰" title="Ordering is offline right now" body="We can't reach the kitchen's order system. Please try again in a moment or call us." action={<PillLink href="/" size="sm">Back to the menu</PillLink>} />
      </div>
    );
  }
  if (empty) {
    return (
      <div className="mx-auto max-w-[520px] px-4 py-16">
        <EmptyState icon="⌾" title="Your basket is empty" body="Nothing selected yet. The bestseller list is a good place to start." action={<PillLink href="/#menu" size="sm">Open the menu</PillLink>} />
      </div>
    );
  }

  const payLine = "Payment is captured on delivery confirmation.";

  return (
    <div className="screen-in mx-auto grid max-w-[1200px] items-start gap-[22px] px-3 pt-[22px] md:px-[22px] lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
      <div className="flex min-w-0 flex-col gap-[18px]">
        <Stepper done={done} current={current} />
        <StatusBanners />

        {/* 1 · CART */}
        <section id="step-1" className="card flex scroll-mt-[96px] flex-col gap-4 p-5 md:p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[22px] font-extrabold leading-[1.3]">Your order</h2>
            <span className="text-[12px] font-medium text-muted">{cart.count} {cart.count === 1 ? "position" : "positions"}</span>
          </div>
          <FreeDeliveryBar />
          <CartLines />
          <PromoField />
        </section>

        {/* 2 · DELIVERY */}
        <DeliveryStep deliveryQuote={deliveryQuote} pickupQuote={pickupQuote} form={form} onForm={setForm} />

        <section className="card flex flex-col gap-4 p-5 md:p-6" aria-labelledby="contact-h">
          <h2 id="contact-h" className="text-[22px] font-extrabold leading-[1.3]">Contact</h2>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="flex flex-col gap-[7px]">
              <span className="sr-only">Name</span>
              <input className="field" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </label>
            <label className="flex flex-col gap-[7px]">
              <span className="sr-only">Phone</span>
              <input className="field" placeholder="+49 30 000 000" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" required />
            </label>
          </div>
          <div className="flex items-center gap-2.5 text-[13px] leading-[1.3] text-ink-3">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-orange text-[11px] font-medium text-white" aria-hidden>✓</span>
            Guest checkout — no account needed
          </div>
        </section>

        {/* 3 · PAYMENT */}
        <section id="step-3" className="card flex scroll-mt-[96px] flex-col gap-4 p-5 md:p-6">
          <h2 className="text-[22px] font-extrabold leading-[1.3]">Payment</h2>
          {methods.length === 0 ? (
            <p className="text-[13px] text-ink-2">No payment methods are enabled yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3" role="radiogroup" aria-label="Payment method">
              {methods.map((m) => {
                const on = method === m;
                return (
                  <button key={m} type="button" role="radio" aria-checked={on} onClick={() => setMethod(m)} className={`flex items-center gap-3 rounded-2xl p-4 text-left text-[13px] leading-[1.3] transition-micro ${on ? "border-2 border-orange bg-orange-tint font-extrabold" : "border border-line-3 font-medium text-ink-2 hover:border-muted"}`}>
                    <span className="h-6 w-[34px] flex-none rounded-md bg-[#F4F0EB]" aria-hidden />
                    <span className="flex-1">{PAY_LABEL[m]}</span>
                    <span className={`h-5 w-5 flex-none rounded-full text-center text-[11px] leading-5 ${on ? "bg-orange font-extrabold text-white" : "border-[1.5px] border-[#DDD6CC]"}`} aria-hidden>{on ? "✓" : ""}</span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[12px] leading-[1.5] text-muted">{payLine}{method === "cash" ? " Cash is confirmed by the courier." : ""}</p>
        </section>
      </div>

      {/* summary */}
      <aside className="flex flex-col gap-4 rounded-[26px] bg-paper p-5 shadow-(--shadow-card-lg) md:p-6 lg:sticky lg:top-[90px]" aria-label="Order summary">
        <div className="flex items-baseline justify-between">
          <h3 className="text-[20px] font-extrabold leading-[1.3]">Order summary</h3>
          <span className="text-[12px] font-medium text-muted">{cart.count} {cart.count === 1 ? "position" : "positions"}</span>
        </div>
        <ul className="flex flex-col gap-3">
          {state.lines.map((l, i) => {
            const ql = quote?.lines.find((q) => q.item_id === l.item_id && [...q.options.map((o) => o.option_id)].sort().join(",") === [...l.option_ids].sort().join(","));
            return (
              <li key={l.key} className="flex items-center gap-3">
                <span className={`h-12 w-12 flex-none rounded-xl ${i % 2 ? "photo-sky" : "photo-sand"}`} aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[14px] font-extrabold leading-[1.2]">{l.name}</span>
                  <span className="truncate text-[12px] text-muted">{l.options_label ? `${l.options_label} · ` : ""}×{l.qty}</span>
                </span>
                <span className="whitespace-nowrap text-[13px] font-extrabold">{ql ? euro(ql.line_total_cents) : "…"}</span>
              </li>
            );
          })}
        </ul>
        <div className="h-px bg-line" />
        <Totals quote={quote} size="lg" />

        {(rejected ?? blocking).length > 0 && (
          <ul className="flex flex-col gap-1.5 rounded-2xl bg-sand px-4 py-3 text-[12px] leading-[1.4] text-ink" role="alert">
            {(rejected ?? blocking).map((p, i) => (
              <li key={i}>• {p.code === "invalid_input" ? `Please add ${fieldLabel(p.field)}.` : problemSummary(p)}</li>
            ))}
          </ul>
        )}
        {failure && <p className="rounded-2xl bg-blush/50 px-4 py-3 text-[12px] leading-[1.4]" role="alert">Could not place the order: {failure}. Nothing was charged — please try again.</p>}
        {!contactOk && cartOk && <p className="text-[12px] text-muted">Add your name and phone number to place the order.</p>}
        {paused && <p className="text-[12px] text-muted">Ordering is paused — the kitchen is sold out today.</p>}

        <Pill size="lg" onClick={submit} disabled={!ready || submitting} className="py-[19px] text-[16px]">
          {submitting ? "Placing order…" : `Place order${quote ? ` · ${euro(quote.total_cents)}` : ""}`}
        </Pill>
        <span className="text-center text-[11px] leading-[1.5] text-muted-2">
          By placing the order you accept the <a href="/agb" className="underline-offset-2 hover:underline">terms of service</a>. {payLine}
        </span>
      </aside>

      {/* mobile sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 bg-paper px-4 pb-6 pt-3.5 shadow-(--shadow-card-lg) lg:hidden">
        <Pill size="lg" onClick={submit} disabled={!ready || submitting} className="justify-between px-5 py-[17px] text-[15px]">
          <span>{submitting ? "Placing order…" : "Place order"}</span>
          <span>{quote ? euro(quote.total_cents) : "…"}</span>
        </Pill>
        <span className="text-center text-[11px] text-muted-2">Guest checkout — no account needed</span>
      </div>
      <div className="h-[110px] lg:hidden" aria-hidden />
    </div>
  );
}
