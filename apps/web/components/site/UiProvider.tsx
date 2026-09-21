"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// Cross-page UI state that isn't the cart: the header search query (filters the Home grid client-side).
type Ui = { query: string; setQuery: (q: string) => void };
const UiContext = createContext<Ui | null>(null);

export function UiProvider({ children, initialQuery = "" }: { children: ReactNode; initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const value = useMemo(() => ({ query, setQuery }), [query]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): Ui {
  const u = useContext(UiContext);
  if (!u) throw new Error("useUi outside UiProvider");
  return u;
}
