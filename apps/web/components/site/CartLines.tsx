"use client";
import { QtyStepper } from "@/components/ui/QtyStepper";
import { useCart, useCatalog, type CartLine } from "@/lib/cart";
import { euro } from "@/lib/money";
import { unavailableReason } from "@/lib/problems";
import type { Problem, Quote } from "@/lib/types";

function lineProblem(problems: Problem[] | undefined, line: CartLine): Problem | undefined {
  return problems?.find((p) => (p.code === "unavailable" || p.code === "invalid_options") && p.item_id === line.item_id);
}

// Cart rows: thumbnail, name, options, server price, qty ±. Problem rows get the reason inline.
export function CartLines({ compact = false }: { compact?: boolean }) {
  const { state, quote, setQty, remove } = useCart();
  const { items } = useCatalog();
  const lines = state.lines;
  const byId = new Map(quote?.lines.map((l) => [l.item_id + ":" + [...l.options.map((o) => o.option_id)].sort().join(","), l]) ?? []);
  const priceFor = (line: CartLine) => byId.get(line.key)?.line_total_cents;
  const thumb = compact ? "h-12 w-12 rounded-xl" : "h-[58px] w-[58px] rounded-[14px]";

  return (
    <ul className="flex flex-col gap-2.5">
      {lines.map((line, i) => {
        const problem = lineProblem(quote?.problems, line);
        const item = items.find((it) => it.id === line.item_id);
        const price = priceFor(line);
        return (
          <li
            key={line.key}
            className={`flex flex-col gap-2 border-b border-line pb-2.5 ${problem ? "rounded-2xl bg-blush/40 p-2.5" : ""}`}
            data-problem={problem ? "true" : undefined}
          >
            <div className="flex items-center gap-3">
              <div className={`flex-none photo-sand ${thumb} ${i % 2 ? "photo-sky" : ""}`} aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className="text-[14px] font-extrabold leading-[1.2]">{item?.name_en ?? line.name}</span>
                {line.options_label && <span className="truncate text-[12px] leading-[1.3] text-muted">{line.options_label}</span>}
                <span className="whitespace-nowrap text-[13px] font-extrabold leading-[1.3] text-orange">
                  {price != null ? euro(price) : <span className="text-muted-2">…</span>}
                </span>
              </div>
              <QtyStepper size="sm" accent value={line.qty} max={item?.max_per_order ?? null} onChange={(q) => (q <= 0 ? remove(line.key) : setQty(line.key, q))} label={`Quantity of ${line.name}`} />
            </div>
            {problem && (
              <div className="flex items-center justify-between gap-2 text-[12px] leading-[1.35] text-ink-2">
                <span>
                  <span className="font-extrabold">{problem.code === "invalid_options" ? "Options changed." : "Unavailable."}</span>{" "}
                  {problem.code === "invalid_options" ? "Open the item and pick again." : unavailableReason(problem)}
                </span>
                <button type="button" onClick={() => remove(line.key)} className="whitespace-nowrap font-extrabold text-orange">
                  Remove
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Totals({ quote, size = "md" }: { quote: Quote | null; size?: "md" | "lg" }) {
  const row = "flex justify-between";
  const promoLabel = quote?.promo ? `Promo ${quote.promo.code}` : "Discount";
  return (
    <div className="flex flex-col gap-[7px] text-[13px] font-medium leading-[1.3] text-ink-2" aria-live="polite">
      <div className={row}><span>Subtotal</span><span className="whitespace-nowrap">{euro(quote?.subtotal_cents)}</span></div>
      {quote && quote.pickup_discount_cents > 0 && (
        <div className={row}><span>Pickup discount</span><span className="text-orange">{euro(-quote.pickup_discount_cents)}</span></div>
      )}
      {quote && quote.promo_discount_cents > 0 && (
        <div className={row}><span>{promoLabel}</span><span className="text-orange">{euro(-quote.promo_discount_cents)}</span></div>
      )}
      {quote?.type === "delivery" && (
        <div className={row}>
          <span>Delivery</span>
          {!quote.zone ? (
            <span className="text-muted">enter postal code</span>
          ) : quote.delivery_fee_cents === 0 ? (
            <span className="font-extrabold text-blue">FREE</span>
          ) : (
            <span>{euro(quote.delivery_fee_cents)}</span>
          )}
        </div>
      )}
      {quote && quote.tip_cents > 0 && <div className={row}><span>Tip</span><span>{euro(quote.tip_cents)}</span></div>}
      <div className={`${row} mt-1 border-t border-line pt-2 font-extrabold text-ink ${size === "lg" ? "text-[24px]" : "text-[19px]"} leading-[1.3]`}>
        <span>Total</span>
        <span className="whitespace-nowrap">{euro(quote?.total_cents)}</span>
      </div>
      {quote && <span className="text-[11px] font-normal text-muted-2">incl. {euro(quote.vat_cents)} VAT</span>}
    </div>
  );
}
