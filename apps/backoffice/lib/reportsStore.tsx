"use client";

// One load of everything BO · Berichte shows: the four `reports_guard()` RPCs (any active staff
// role) plus `report_payments` (owner/operator only, §8.5 — narrower by design, not an error). The
// screen itself stays owner/operator (requireRole in app/(shell)/reports/page.tsx), so the narrower
// guard should never actually fire here — reading it defensively is cheap and correct either way.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { defaultRange, type PeriodRange } from "@/lib/reports";
import type { DeliveryTimeRow, FunnelRow, PaymentReportRow, RevenueByDayRow, Staff, TopItemRow } from "@/lib/types";

export type ReportsData = {
  me: Staff;
  range: PeriodRange;
  setRange: (r: PeriodRange) => void;
  revenueByDay: RevenueByDayRow[];
  topItems: TopItemRow[];
  funnel: FunnelRow | null;
  deliveryTimes: DeliveryTimeRow[];
  payments: PaymentReportRow[] | null;
  paymentsError: { code?: string } | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const Ctx = createContext<ReportsData | null>(null);

// `to_date` is inclusive on the DB side already, calling with the Berlin calendar date is enough —
// no +1 day adjustment here (unlike History.tsx's `created_at` range query, which filters a
// timestamp column directly and therefore does need the exclusive upper bound).
export function ReportsProvider({ me, children }: { me: Staff; children: ReactNode }) {
  const supabase = useSupabase();
  const [range, setRange] = useState<PeriodRange>(() => defaultRange(new Date()));
  const [revenueByDay, setRevenueByDay] = useState<RevenueByDayRow[]>([]);
  const [topItems, setTopItems] = useState<TopItemRow[]>([]);
  const [funnel, setFunnel] = useState<FunnelRow | null>(null);
  const [deliveryTimes, setDeliveryTimes] = useState<DeliveryTimeRow[]>([]);
  const [payments, setPayments] = useState<PaymentReportRow[] | null>(null);
  const [paymentsError, setPaymentsError] = useState<{ code?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const args = { from_date: range.from, to_date: range.to };
    const [rev, top, fun, dt, pay] = await Promise.all([
      supabase.rpc("report_revenue_by_day", args),
      supabase.rpc("report_top_items", { ...args, limit_count: 20 }),
      supabase.rpc("report_funnel", args),
      supabase.rpc("report_delivery_times", args),
      supabase.rpc("report_payments", args),
    ]);
    // report_payments is allowed to fail with 42501 for a role this screen never actually admits —
    // that is a designed state (paymentsView in lib/reports.ts), not a screen-level error.
    setError(rev.error?.message ?? top.error?.message ?? fun.error?.message ?? dt.error?.message ?? null);
    setRevenueByDay((rev.data ?? []) as RevenueByDayRow[]);
    setTopItems((top.data ?? []) as TopItemRow[]);
    setFunnel(((fun.data ?? [])[0] ?? null) as FunnelRow | null);
    setDeliveryTimes((dt.data ?? []) as DeliveryTimeRow[]);
    setPayments(pay.error ? null : ((pay.data ?? []) as PaymentReportRow[]));
    setPaymentsError(pay.error ? { code: pay.error.code } : null);
    setLoading(false);
  }, [supabase, range]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<ReportsData>(
    () => ({ me, range, setRange, revenueByDay, topItems, funnel, deliveryTimes, payments, paymentsError, loading, error, reload }),
    [me, range, revenueByDay, topItems, funnel, deliveryTimes, payments, paymentsError, loading, error, reload],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReports(): ReportsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useReports outside ReportsProvider");
  return v;
}
