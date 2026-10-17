// The single seam between the UI and the backend (api-contracts §5).
// Implementations: lib/api-supabase.ts (real, default) and lib/api-mock.ts (in-memory seed data).
// Switch with NEXT_PUBLIC_API=mock|supabase — see README "Mock layer".
import type { Catalog, OrderAttemptPayload, PlaceOrderPayload, PlaceOrderResult, Quote, QuotePayload, TrackedOrder } from "./types";

export interface ShoshoApi {
  /** Menu + zones + public settings. Never throws: an unreachable backend yields `online: false`. */
  getCatalog(): Promise<Catalog>;
  /** `rpc('quote_order')` — pure; the totals the UI shows come only from here. */
  quoteOrder(payload: QuotePayload): Promise<Quote>;
  /** `rpc('place_order')` — throws OrderRejectedError with the server's problems. */
  placeOrder(payload: PlaceOrderPayload): Promise<PlaceOrderResult>;
  /** `rpc('get_order_by_token')` — null for an unknown token. */
  getOrderByToken(token: string): Promise<TrackedOrder | null>;
  /**
   * Realtime broadcast on `order:<token>` (api-contracts §3/§5.6) — fires `onUpdate` on every
   * meaningful change so the caller can re-fetch. The caller keeps polling as the documented
   * fallback; this is the fast path, not a replacement. Returns an unsubscribe function. The mock
   * layer has no realtime, so it is a no-op there — the poll alone drives tracking under
   * NEXT_PUBLIC_API=mock.
   */
  subscribeToOrder(token: string, onUpdate: () => void): () => void;
  /** `rpc('record_order_attempt')` — funnel telemetry (§1.7). Never throws: a lost row is not the guest's problem. */
  recordOrderAttempt(payload: OrderAttemptPayload): Promise<void>;
}

export type ApiMode = "supabase" | "mock";

export function apiMode(): ApiMode {
  return process.env.NEXT_PUBLIC_API === "mock" ? "mock" : "supabase";
}

let cached: ShoshoApi | null = null;

/** Returns the configured implementation (memoised per runtime — server or browser). */
export async function getApi(): Promise<ShoshoApi> {
  if (cached) return cached;
  if (apiMode() === "mock") {
    const { createMockApi } = await import("./api-mock");
    cached = createMockApi();
  } else {
    const { createSupabaseApi } = await import("./api-supabase");
    cached = createSupabaseApi();
  }
  return cached;
}
