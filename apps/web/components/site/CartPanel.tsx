"use client";
import { PillLink } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
import { useCart } from "@/lib/cart";
import { euro } from "@/lib/money";
import { CartLines, Totals } from "./CartLines";
import { FreeDeliveryBar } from "./FreeDeliveryBar";
import { PromoField } from "./PromoField";
import { StatusBanners, useOrderingState } from "./StatusBanners";

const MARKS = ["VISA", "MC", "G PAY", "APPLE PAY", "BTC"];

// Sticky "Your order" panel (desktop, Home + Product). Totals are the server's quote — nothing computed here.
export function CartPanel() {
  const { state, count, quote, quoting, quoteError, hydrated } = useCart();
  const { canOrder } = useOrderingState();
  const empty = hydrated && state.lines.length === 0;
  // address, slot and promo problems are resolved on the checkout page — only broken lines block here
  const blocked = !canOrder || Boolean(quote && quote.problems.some((p) => p.code === "unavailable" || p.code === "invalid_options" || p.code === "empty_cart"));

  return (
    <aside className="sticky top-[90px] hidden w-full max-w-[380px] flex-none flex-col gap-4 rounded-[26px] bg-paper p-[22px] shadow-(--shadow-card-lg) lg:flex" aria-label="Your order">
      <div className="flex items-baseline justify-between gap-2.5">
        <h3 className="whitespace-nowrap text-[20px] font-extrabold leading-[1.3]">Your order</h3>
        <span className="whitespace-nowrap text-[12px] font-medium leading-[1.3] text-muted">{count} {count === 1 ? "position" : "positions"}</span>
      </div>
      {empty ? (
        <EmptyState
          icon="⌾"
          title="Your basket is empty"
          body="Nothing selected yet. The bestseller list is a good place to start."
          action={<PillLink href="/#menu" size="sm">Open the menu</PillLink>}
          className="shadow-none px-2 py-5"
        />
      ) : (
        <>
          <StatusBanners compact />
          <FreeDeliveryBar />
          <CartLines />
          <PromoField />
          {quoteError && <span className="text-[12px] text-ink-2" role="alert">Could not fetch prices — {quoteError}. Retrying on your next change.</span>}
          <Totals quote={quote} />
          <PillLink href="/checkout" size="lg" className={`py-[18px] text-[16px] ${blocked ? "pointer-events-none opacity-50 shadow-none" : ""}`} aria-disabled={blocked}>
            Checkout{quote ? ` · ${euro(quote.total_cents)}` : ""}
            {quoting && <span className="sr-only">updating</span>}
          </PillLink>
          <div className="flex items-center justify-center gap-2.5 text-[11px] font-medium leading-[1.3] tracking-[0.06em] text-muted-2" aria-hidden>
            {MARKS.map((m) => <span key={m}>{m}</span>)}
          </div>
        </>
      )}
    </aside>
  );
}
