"use client";
import { useEffect, useState } from "react";
import { getApi } from "./api";

/**
 * Live price of one configured line, from quote_order (no client-side price math). Quoted as a
 * single-line pickup order so zone/hours don't matter; `line_total_cents` is what the button shows.
 */
export function useLinePrice(item_id: string, option_ids: string[], qty: number, debounceMs = 250): { cents: number | null; loading: boolean } {
  const [cents, setCents] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const key = `${item_id}|${[...option_ids].sort().join(",")}|${qty}`;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const api = await getApi();
        const q = await api.quoteOrder({ type: "pickup", items: [{ item_id, qty, option_ids }] });
        if (alive) setCents(q.lines[0]?.line_total_cents ?? null);
      } catch {
        if (alive) setCents(null);
      } finally {
        if (alive) setLoading(false);
      }
    }, debounceMs);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs]);
  return { cents, loading };
}
