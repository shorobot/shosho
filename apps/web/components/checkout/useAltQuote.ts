"use client";
import { useEffect, useState } from "react";
import { getApi } from "@/lib/api";
import { quotePayloadFor, useCart } from "@/lib/cart";
import type { OrderType, Quote } from "@/lib/types";

/** Quote of the cart for the *other* fulfilment type — feeds the Delivery / Pickup cards with server numbers. */
export function useAltQuote(type: OrderType): Quote | null {
  const { state, hydrated } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const key = JSON.stringify({ l: state.lines.map((l) => [l.item_id, l.qty, l.option_ids]), p: state.address.postal_code, c: state.promo_code, s: state.scheduled_for });
  useEffect(() => {
    if (!hydrated || state.lines.length === 0) {
      setQuote(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const api = await getApi();
        const q = await api.quoteOrder(quotePayloadFor({ ...state, type }, { postal_code: state.address.postal_code.trim() || undefined }));
        if (alive) setQuote(q);
      } catch {
        if (alive) setQuote(null);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, type, hydrated]);
  return quote;
}
