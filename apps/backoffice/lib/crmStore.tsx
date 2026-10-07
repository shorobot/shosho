"use client";

// One load of the customer book for the Kunden list, and a per-profile loader for Profil.
// Reads are plain PostgREST selects (§6.4); writes go through `run()` so an RLS denial always
// surfaces as the same German sentence instead of a raw Postgres error — same pattern as menuStore.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { statsOf, type Stats } from "@/lib/crm";
import type { Key, Lang } from "@/lib/i18n";
import { run as guardedRun } from "@/lib/menuStore";
import { ORDER_SELECT, type Customer, type CustomerEventRow, type CustomerStatsRow, type Order, type Staff, type StaffDirectoryRow } from "@/lib/types";
import { CUSTOMER_SELECT } from "@/lib/types";

/** CRM copy for a failed write, so a denial does not talk about the menu. */
const CRM_KEYS: { denied: Key; saveError: Key } = { denied: "crm.denied", saveError: "crm.saveError" };

/** `run()` with the CRM's own error copy. */
export function run<R extends { data: unknown; error: { code?: string; message?: string } | null }>(
  lang: Lang,
  op: () => PromiseLike<R>,
) {
  return guardedRun(lang, op as never, CRM_KEYS);
}

export type CrmRow = { customer: Customer; stats: Stats };

export type CrmData = {
  me: Staff;
  canWrite: boolean;
  rows: CrmRow[];
  /** `staff_directory`, not the base `staff` table — §6.9 row 2. Resolves timeline actor names. */
  staff: StaffDirectoryRow[];
  loading: boolean;
  error: string | null;
  now: Date;
  reload: () => Promise<void>;
};

const Ctx = createContext<CrmData | null>(null);

export function CrmProvider({ me, children }: { me: Staff; children: ReactNode }) {
  const supabase = useSupabase();
  const [rows, setRows] = useState<CrmRow[]>([]);
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // One clock for every "days silent" and "this month" decision in the subtree, so two rows rendered
  // in the same pass cannot disagree about what day it is.
  const [now, setNow] = useState(() => new Date());

  const reload = useCallback(async () => {
    setLoading(true);
    const [cs, st, dir] = await Promise.all([
      supabase.from("customers").select(CUSTOMER_SELECT).order("name"),
      supabase.from("customer_stats").select("*"),
      supabase.from("staff_directory").select("*"),
    ]);
    const first = cs.error ?? st.error ?? dir.error;
    setError(first?.message ?? null);
    const byId = new Map<string, CustomerStatsRow>();
    for (const s of st.data ?? []) if (s.customer_id) byId.set(s.customer_id, s);
    setRows(((cs.data ?? []) as Customer[]).map((c) => ({ customer: c, stats: statsOf(byId.get(c.id)) })));
    setStaff(dir.data ?? []);
    setNow(new Date());
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<CrmData>(
    () => ({ me, canWrite: me.role === "owner" || me.role === "operator", rows, staff, loading, error, now, reload }),
    [me, rows, staff, loading, error, now, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCrm(): CrmData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCrm outside CrmProvider");
  return v;
}

/* ------------------------------------------------------------------ one profile */

export type CustomerDetail = {
  events: CustomerEventRow[];
  orders: Order[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/**
 * The timeline and order history for one customer, loaded per profile rather than with the list —
 * the list is one row per customer, the profile wants every event and every order for one of them.
 *
 * `customer_events` is in the realtime publication (§6.8), so an open profile subscribes to its own
 * customer's rows the way the orders board does: a complaint added by a colleague appears without a
 * reload. The filter is server-side, so no other customer's events reach this client.
 */
export function useCustomerDetail(customerId: string): CustomerDetail {
  const supabase = useSupabase();
  const [events, setEvents] = useState<CustomerEventRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [ev, ord] = await Promise.all([
      supabase.from("customer_events").select("*").eq("customer_id", customerId).order("at", { ascending: false }),
      supabase.from("orders").select(ORDER_SELECT).eq("customer_id", customerId).order("created_at", { ascending: false }),
    ]);
    setError(ev.error?.message ?? ord.error?.message ?? null);
    setEvents(ev.data ?? []);
    setOrders((ord.data ?? []) as Order[]);
    setLoading(false);
  }, [supabase, customerId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const channel = supabase
      .channel(`customer_events:${customerId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "customer_events", filter: `customer_id=eq.${customerId}` },
        (payload) => {
          const row = payload.new as CustomerEventRow;
          // Guard against a double-insert echo: the row may already be here from our own write.
          setEvents((prev) => (prev.some((e) => e.id === row.id) ? prev : [row, ...prev]));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, customerId]);

  return { events, orders, loading, error, reload };
}
