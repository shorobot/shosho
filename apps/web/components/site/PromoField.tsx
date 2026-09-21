"use client";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { promoReason } from "@/lib/problems";

// PROMOCODE row: sand plate; applied code shows "SHOSHO10 ✕"; invalid → reason under the field.
export function PromoField() {
  const { state, quote, setPromo } = useCart();
  const [draft, setDraft] = useState("");
  const applied = state.promo_code;
  const problem = quote?.problems.find((p) => p.code === "promo_invalid");
  const valid = Boolean(applied && quote?.promo && quote.promo.code === applied);

  useEffect(() => {
    if (!applied) setDraft("");
  }, [applied]);

  return (
    <div className="flex flex-col gap-1.5">
      <form
        className="flex items-center justify-between gap-2 rounded-[14px] bg-sand px-3.5 py-[9px]"
        onSubmit={(e) => {
          e.preventDefault();
          setPromo(draft);
        }}
      >
        <label htmlFor="promo" className="text-[12px] font-medium leading-[1.3] tracking-[0.06em] text-ink-2">PROMOCODE</label>
        {applied ? (
          <button type="button" onClick={() => setPromo("")} className={`text-[12px] font-extrabold leading-[1.3] ${valid ? "text-orange" : "text-ink-3"}`} aria-label={`Remove code ${applied}`}>
            {applied} ✕
          </button>
        ) : (
          <span className="flex items-center gap-2">
            <input
              id="promo"
              value={draft}
              onChange={(e) => setDraft(e.target.value.toUpperCase())}
              placeholder="Enter code"
              className="w-[110px] bg-transparent text-right text-[12px] font-extrabold uppercase text-ink outline-none placeholder:font-medium placeholder:text-sand-ink"
            />
            <button type="submit" className="text-[12px] font-extrabold text-orange disabled:opacity-40" disabled={!draft.trim()}>Apply</button>
          </span>
        )}
      </form>
      {applied && problem && <span className="px-1 text-[12px] leading-[1.35] text-ink-2" role="alert">{promoReason(problem.reason)}</span>}
    </div>
  );
}
