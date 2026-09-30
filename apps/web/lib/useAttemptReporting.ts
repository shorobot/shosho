"use client";
// The storefront's side of `record_order_attempt` (lib/attempts.ts, api-contracts §1.7). One tracker
// per CartProvider, so both call sites share one session id and one "already recorded" set:
//
//   * `useAttemptReporting` watches `quote_order` and files a row when the guest sits on a blocking
//     problems[] state — out of zone, below the minimum, closed, item unavailable.
//   * the `reportRejection` it returns is called by CheckoutClient when `place_order` is refused.
//
// Fires once per distinct problem state, not per render and not per keystroke: `quote_order` runs on
// every cart change, and the RPC's ceiling is 20 rows per session per minute. Two guards — the effect
// keys on the state's signature, and the tracker refuses a signature it has already sent (persisted
// in sessionStorage, so a reload does not re-file it).
import { useCallback, useEffect, useMemo, useRef } from "react";
import { getApi } from "./api";
import { createAttemptTracker, loadSeen, problemSignature, reportableProblems, saveSeen, sessionHash, type AttemptInput } from "./attempts";
import type { CartState } from "./cart";
import type { Problem, Quote } from "./types";

/** How long a blocking state must survive before it counts — long enough to outlast typing. */
export const ATTEMPT_DELAY_MS = 1500;

export function attemptInputFor(state: CartState, problems: Problem[], subtotal_cents?: number): AttemptInput {
  return {
    type: state.type,
    problems,
    postal_code: state.type === "delivery" ? state.address.postal_code : undefined,
    subtotal_cents,
    items: state.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })),
    promo_code: state.promo_code || undefined,
  };
}

export function useAttemptReporting(state: CartState, quote: Quote | null, delayMs = ATTEMPT_DELAY_MS) {
  const seen = useRef<Set<string> | null>(null);
  // The effect and the rejection callback both read the live cart; a ref keeps them off the deps list
  // so a re-render can never restart the timer or re-file a row.
  const latest = useRef({ state, quote });
  latest.current = { state, quote };

  const tracker = useMemo(() => {
    seen.current ??= loadSeen();
    return createAttemptTracker({
      session: sessionHash,
      seen: seen.current,
      send: (payload) => void getApi().then((api) => api.recordOrderAttempt(payload)),
    });
  }, []);

  const blocking = reportableProblems(quote?.problems);
  const signature = blocking.length ? problemSignature(blocking) : "";

  useEffect(() => {
    if (!signature) return;
    const t = setTimeout(() => {
      const { state: s, quote: q } = latest.current;
      if (tracker.consider(attemptInputFor(s, q?.problems ?? [], q?.subtotal_cents)) && seen.current) saveSeen(seen.current);
    }, delayMs);
    return () => clearTimeout(t);
  }, [signature, delayMs, tracker]);

  /** Call site 1: `place_order` was refused. Always recorded — a refusal at the last step is the point. */
  return useCallback(
    (problems: Problem[]) => {
      const { state: s, quote: q } = latest.current;
      if (tracker.reject(attemptInputFor(s, problems, q?.subtotal_cents)) && seen.current) saveSeen(seen.current);
    },
    [tracker],
  );
}
