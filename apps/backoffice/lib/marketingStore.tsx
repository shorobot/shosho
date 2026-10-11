"use client";

// One load of everything BO · Marketing shows (api-contracts §8.1–§8.4, §1.5). Reads are plain
// PostgREST selects; writes go through `run()` so an RLS denial reads as a sentence.
//
// `promo_codes`, `campaigns` and `automations` are all owner/operator CRUD — no RPC needed to draft
// one (§8.1/§8.4). `campaign_recipients` and `automation_runs` are staff READ-ONLY with no insert
// policy for any role, so nothing here can write them; that is S5's service-role job and the reason
// "Senden" cannot work yet rather than merely being switched off.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import type { Key, Lang } from "@/lib/i18n";
import {
  sortAutomations,
  type AutomationRow,
  type AutomationRunRow,
  type CampaignChannel,
  type CampaignRow,
  type MarketingOrder,
  type PromoRow,
  type ResolvedRecipient,
  type Segment,
} from "@/lib/marketing";
import { segmentToJson } from "@/lib/marketing";
import { run as guardedRun } from "@/lib/menuStore";
import { addDays } from "@/lib/time";
import type { MenuCategoryRow, Staff } from "@/lib/types";

const MKT_KEYS: { denied: Key; saveError: Key } = { denied: "mkt.denied", saveError: "mkt.saveError" };

export function run<R extends { data: unknown; error: { code?: string; message?: string } | null }>(
  lang: Lang,
  op: () => PromiseLike<R>,
) {
  return guardedRun(lang, op as never, MKT_KEYS);
}

/** How far back the KPI window and the weekday chart look. */
export const KPI_WINDOW_DAYS = 30;

export type MarketingData = {
  me: Staff;
  canWrite: boolean;
  promos: PromoRow[];
  campaigns: CampaignRow[];
  automations: AutomationRow[];
  runs: AutomationRunRow[];
  categories: MenuCategoryRow[];
  /** Completed-order slice for the KPIs — five columns, nothing else is read from `orders`. */
  orders: MarketingOrder[];
  /** Non-anonymised customer profiles, as context for a recipient count (never as a segment match). */
  customerCount: number | null;
  loading: boolean;
  error: string | null;
  now: Date;
  /** Window the KPIs cover: [from, to]. */
  from: Date;
  to: Date;
  reload: () => Promise<void>;
  /**
   * `resolve_segment(segment, channel)` — THE one implementation, used for the wizard's count and
   * (once a sender exists) for the send itself. The channel is always the campaign's own; there is
   * no default, which is the point of §8.2's required second argument.
   */
  resolveSegment: (lang: Lang, segment: Segment, channel: CampaignChannel) => Promise<ResolvedRecipient[] | null>;
};

const Ctx = createContext<MarketingData | null>(null);

export function MarketingProvider({ me, children }: { me: Staff; children: ReactNode }) {
  const supabase = useSupabase();
  const [promos, setPromos] = useState<PromoRow[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [runs, setRuns] = useState<AutomationRunRow[]>([]);
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [orders, setOrders] = useState<MarketingOrder[]>([]);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const reload = useCallback(async () => {
    setLoading(true);
    const clock = new Date();
    const since = addDays(clock, -KPI_WINDOW_DAYS).toISOString();
    const [pc, cp, au, ar, cat, ord, cust] = await Promise.all([
      supabase.from("promo_codes").select("*").order("code"),
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }),
      supabase.from("automations").select("*"),
      supabase.from("automation_runs").select("*").order("at", { ascending: false }).limit(50),
      supabase.from("menu_categories").select("*").order("sort"),
      supabase.from("orders").select("created_at, status, total_cents, discount_cents, promo_code").gte("created_at", since),
      supabase.from("customers").select("id", { count: "exact", head: true }).is("anonymised_at", null),
    ]);
    setError(pc.error?.message ?? cp.error?.message ?? au.error?.message ?? cat.error?.message ?? ord.error?.message ?? null);
    setPromos(pc.data ?? []);
    setCampaigns(cp.data ?? []);
    setAutomations(sortAutomations(au.data ?? []));
    setRuns(ar.data ?? []);
    setCategories(cat.data ?? []);
    setOrders((ord.data ?? []) as MarketingOrder[]);
    setCustomerCount(cust.error ? null : (cust.count ?? null));
    setNow(clock);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const resolveSegment = useCallback(
    async (lang: Lang, segment: Segment, channel: CampaignChannel) => {
      const res = await run(lang, () => supabase.rpc("resolve_segment", { p_segment: segmentToJson(segment), p_channel: channel }));
      return res == null ? null : (res as ResolvedRecipient[]);
    },
    [supabase],
  );

  const value = useMemo<MarketingData>(
    () => ({
      me,
      canWrite: me.role === "owner" || me.role === "operator",
      promos,
      campaigns,
      automations,
      runs,
      categories,
      orders,
      customerCount,
      loading,
      error,
      now,
      from: addDays(now, -KPI_WINDOW_DAYS),
      to: now,
      reload,
      resolveSegment,
    }),
    [me, promos, campaigns, automations, runs, categories, orders, customerCount, loading, error, now, reload, resolveSegment],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMarketing(): MarketingData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMarketing outside MarketingProvider");
  return v;
}
