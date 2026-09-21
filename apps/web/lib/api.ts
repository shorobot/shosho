// The single seam between the UI and the backend (api-contracts §5).
// Implementations: lib/api-supabase.ts (real, default) and lib/api-mock.ts (in-memory seed data).
// Switch with NEXT_PUBLIC_API=mock|supabase — see README "Mock layer".
import type { Catalog, PlaceOrderPayload, PlaceOrderResult, Quote, QuotePayload, TrackedOrder } from "./types";

export interface ShoshoApi {
  /** Menu + zones + public settings. Never throws: an unreachable backend yields `online: false`. */
  getCatalog(): Promise<Catalog>;
  /** `rpc('quote_order')` — pure; the totals the UI shows come only from here. */
  quoteOrder(payload: QuotePayload): Promise<Quote>;
  /** `rpc('place_order')` — throws OrderRejectedError with the server's problems. */
  placeOrder(payload: PlaceOrderPayload): Promise<PlaceOrderResult>;
  /** `rpc('get_order_by_token')` — null for an unknown token. */
  getOrderByToken(token: string): Promise<TrackedOrder | null>;
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
