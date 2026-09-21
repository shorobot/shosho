"use client";
// Cart = client state persisted to localStorage. Every change is quoted by rpc('quote_order')
// (debounced ~300 ms); the totals shown anywhere are the server's — nothing is priced here.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { getApi } from "./api";
import type { Catalog, MenuItem, OrderType, Quote, QuotePayload } from "./types";

export type CartLine = {
  key: string;
  item_id: string;
  qty: number;
  option_ids: string[];
  /** display snapshots (names come from the catalog; prices never) */
  name: string;
  name_ja: string | null;
  options_label: string;
};

export type CartAddress = { street: string; floor_apt: string; postal_code: string; city: string };

export type CartState = {
  type: OrderType;
  address: CartAddress;
  lines: CartLine[];
  promo_code: string;
  scheduled_for: string | null;
  tip_cents: number;
};

const STORAGE_KEY = "shosho.cart.v1";
export const TRACKING_KEY = "shosho.tracking.v1";

export const emptyCart: CartState = {
  type: "delivery",
  address: { street: "", floor_apt: "", postal_code: "", city: "Berlin" },
  lines: [],
  promo_code: "",
  scheduled_for: null,
  tip_cents: 0,
};

type Action =
  | { type: "hydrate"; state: CartState }
  | { type: "add"; line: Omit<CartLine, "key"> }
  | { type: "setQty"; key: string; qty: number }
  | { type: "remove"; key: string }
  | { type: "setType"; orderType: OrderType }
  | { type: "setAddress"; address: Partial<CartAddress> }
  | { type: "setPromo"; code: string }
  | { type: "setSchedule"; iso: string | null }
  | { type: "setTip"; cents: number }
  | { type: "clear" };

export function lineKey(item_id: string, option_ids: string[]): string {
  return `${item_id}:${[...option_ids].sort().join(",")}`;
}

export function cartReducer(state: CartState, action: Action): CartState {
  switch (action.type) {
    case "hydrate":
      return { ...emptyCart, ...action.state, address: { ...emptyCart.address, ...action.state.address } };
    case "add": {
      const key = lineKey(action.line.item_id, action.line.option_ids);
      const existing = state.lines.find((l) => l.key === key);
      const lines = existing
        ? state.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + action.line.qty } : l))
        : [...state.lines, { ...action.line, key }];
      return { ...state, lines };
    }
    case "setQty":
      return {
        ...state,
        lines: action.qty <= 0 ? state.lines.filter((l) => l.key !== action.key) : state.lines.map((l) => (l.key === action.key ? { ...l, qty: action.qty } : l)),
      };
    case "remove":
      return { ...state, lines: state.lines.filter((l) => l.key !== action.key) };
    case "setType":
      return { ...state, type: action.orderType };
    case "setAddress":
      return { ...state, address: { ...state.address, ...action.address } };
    case "setPromo":
      return { ...state, promo_code: action.code.toUpperCase().trim() };
    case "setSchedule":
      return { ...state, scheduled_for: action.iso };
    case "setTip":
      return { ...state, tip_cents: Math.max(0, action.cents) };
    case "clear":
      return { ...emptyCart, type: state.type, address: state.address };
    default:
      return state;
  }
}

export function quotePayloadFor(state: CartState, overrides: Partial<QuotePayload> = {}): QuotePayload {
  return {
    type: state.type,
    items: state.lines.map((l) => ({ item_id: l.item_id, qty: l.qty, option_ids: l.option_ids })),
    postal_code: state.type === "delivery" ? state.address.postal_code.trim() || undefined : undefined,
    promo_code: state.promo_code || undefined,
    scheduled_for: state.scheduled_for,
    tip_cents: state.tip_cents || undefined,
    ...overrides,
  };
}

type CartContextValue = {
  state: CartState;
  hydrated: boolean;
  count: number;
  quote: Quote | null;
  quoting: boolean;
  quoteError: string | null;
  /** re-run the quote now (e.g. after a phone number is typed for first-order promos) */
  requote: (overrides?: Partial<QuotePayload>) => Promise<Quote | null>;
  add: (item: MenuItem, option_ids: string[], qty: number, options_label: string) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  setType: (t: OrderType) => void;
  setAddress: (a: Partial<CartAddress>) => void;
  setPromo: (code: string) => void;
  setSchedule: (iso: string | null) => void;
  setTip: (cents: number) => void;
  clear: () => void;
  /** transient "added" flash for the mobile bar / panel */
  lastAddedAt: number;
};

const CartContext = createContext<CartContextValue | null>(null);
const CatalogContext = createContext<Catalog | null>(null);

export function CatalogProvider({ catalog, children }: { catalog: Catalog; children: ReactNode }) {
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): Catalog {
  const c = useContext(CatalogContext);
  if (!c) throw new Error("useCatalog outside CatalogProvider");
  return c;
}

export function CartProvider({ children, debounceMs = 300 }: { children: ReactNode; debounceMs?: number }) {
  const [state, dispatch] = useReducer(cartReducer, emptyCart);
  const [hydrated, setHydrated] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [lastAddedAt, setLastAddedAt] = useState(0);
  const seq = useRef(0);

  // hydrate from localStorage once
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) dispatch({ type: "hydrate", state: JSON.parse(raw) as CartState });
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  // persist
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* private mode */
    }
  }, [state, hydrated]);

  const runQuote = useCallback(
    async (overrides?: Partial<QuotePayload>) => {
      if (state.lines.length === 0) {
        setQuote(null);
        setQuoteError(null);
        return null;
      }
      const id = ++seq.current;
      setQuoting(true);
      try {
        const api = await getApi();
        const q = await api.quoteOrder(quotePayloadFor(state, overrides));
        if (id === seq.current) {
          setQuote(q);
          setQuoteError(null);
        }
        return q;
      } catch (e) {
        if (id === seq.current) setQuoteError(e instanceof Error ? e.message : "Could not reach the kitchen");
        return null;
      } finally {
        if (id === seq.current) setQuoting(false);
      }
    },
    [state],
  );

  // debounced quote on every cart change
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => void runQuote(), debounceMs);
    return () => clearTimeout(t);
  }, [hydrated, runQuote, debounceMs]);

  const value = useMemo<CartContextValue>(
    () => ({
      state,
      hydrated,
      count: state.lines.reduce((n, l) => n + l.qty, 0),
      quote,
      quoting,
      quoteError,
      requote: runQuote,
      add: (item, option_ids, qty, options_label) => {
        dispatch({ type: "add", line: { item_id: item.id, qty, option_ids, name: item.name_en, name_ja: item.name_ja, options_label } });
        setLastAddedAt(Date.now());
      },
      setQty: (key, qty) => dispatch({ type: "setQty", key, qty }),
      remove: (key) => dispatch({ type: "remove", key }),
      setType: (orderType) => dispatch({ type: "setType", orderType }),
      setAddress: (address) => dispatch({ type: "setAddress", address }),
      setPromo: (code) => dispatch({ type: "setPromo", code }),
      setSchedule: (iso) => dispatch({ type: "setSchedule", iso }),
      setTip: (cents) => dispatch({ type: "setTip", cents }),
      clear: () => dispatch({ type: "clear" }),
      lastAddedAt,
    }),
    [state, hydrated, quote, quoting, quoteError, runQuote, lastAddedAt],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const c = useContext(CartContext);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}

/** Remember the guest's tracking tokens (latest first) so /order can offer "your last order". */
export function rememberTracking(token: string, number: number) {
  try {
    const list = JSON.parse(window.localStorage.getItem(TRACKING_KEY) ?? "[]") as { token: string; number: number; at: string }[];
    window.localStorage.setItem(TRACKING_KEY, JSON.stringify([{ token, number, at: new Date().toISOString() }, ...list.filter((x) => x.token !== token)].slice(0, 10)));
  } catch {
    /* ignore */
  }
}

export function recentTracking(): { token: string; number: number; at: string }[] {
  try {
    return JSON.parse(window.localStorage.getItem(TRACKING_KEY) ?? "[]");
  } catch {
    return [];
  }
}
