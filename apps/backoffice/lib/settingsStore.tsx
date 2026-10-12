"use client";

// One load of everything BO · Einstellungen shows (api-contracts §6.6 / §6.9). Unlike BO · Website's
// `settings` keys, nothing here goes through `draft` + `publish_site()` — `ops`/`kitchen.status`
// take effect on the next order the moment they are saved, and staging them behind a publish step
// that exists for website copy would be the wrong model for an operational dial.
//
// `settings` is OWNER-write (`settings_owner_write`, the only write policy on the table) — an
// operator's update is RLS-filtered to zero rows and returns `{ data: [], error: null }` (S4-03's
// finding, same as BO · Website). Every write here therefore goes through `run()` from lib/menuStore
// and checks `wrote()`, exactly like BO · Website does.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { translate, type Key, type Lang } from "@/lib/i18n";
import { run as guardedRun } from "@/lib/menuStore";
import type { BusinessValue, SettingsRow } from "@/lib/site";
import { toast } from "@/lib/toast";
import { wrote } from "@/lib/write";
import type { Json, Staff, StaffDirectoryRow } from "@/lib/types";

const SETTINGS_KEYS = ["ops", "kitchen.status", "payments", "payments.enabled", "business"] as const;

const KEYS: { denied: Key; saveError: Key } = { denied: "set.denied", saveError: "set.saveError" };

export function run<R extends { data: unknown; error: { code?: string; message?: string } | null }>(lang: Lang, op: () => PromiseLike<R>) {
  return guardedRun(lang, op as never, KEYS);
}

export type SettingsData = {
  me: Staff;
  /** `settings` is owner-write; an operator gets the whole screen read-only, not a Postgres error. */
  canEdit: boolean;
  settingsByKey: Map<string, SettingsRow>;
  business: BusinessValue;
  team: StaffDirectoryRow[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  /** Merge-patch one key's JSON value. Returns false (and toasts) on a denial or a silent RLS no-op. */
  writeKey: (lang: Lang, key: string, next: Json) => Promise<boolean>;
};

const Ctx = createContext<SettingsData | null>(null);

export function SettingsProvider({ me, children }: { me: Staff; children: ReactNode }) {
  const supabase = useSupabase();
  const [settings, setSettings] = useState<SettingsRow[]>([]);
  const [team, setTeam] = useState<StaffDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [st, dir] = await Promise.all([
      supabase.from("settings").select("*").in("key", SETTINGS_KEYS).order("key"),
      supabase.from("staff_directory").select("*"),
    ]);
    setError(st.error?.message ?? dir.error?.message ?? null);
    setSettings(st.data ?? []);
    setTeam(dir.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const writeKey = useCallback(
    async (lang: Lang, key: string, next: Json) => {
      // A plain `.update()`, not `.upsert()` — every key here already exists from seed.sql and is
      // never deleted, so there is no insert path to reason about, and `.update()` is the exact
      // shape S4-04 already proved detects an RLS no-op correctly (an operator's write is filtered
      // to zero rows, not refused with an error). `.select("key")` is what makes that detectable.
      const res = await run(lang, () => supabase.from("settings").update({ value: next }).eq("key", key).select("key"));
      if (res == null) return false;
      if (!wrote(res)) {
        toast(translate(lang, "set.noop"));
        return false;
      }
      await reload();
      toast(translate(lang, "set.saved"), "ok");
      return true;
    },
    [supabase, reload],
  );

  const value = useMemo<SettingsData>(() => {
    const settingsByKey = new Map(settings.map((s) => [s.key, s]));
    const businessRow = settingsByKey.get("business");
    const o = businessRow?.value && typeof businessRow.value === "object" && !Array.isArray(businessRow.value) ? (businessRow.value as Record<string, Json>) : {};
    const business: BusinessValue = { impressum: typeof o.impressum === "string" ? o.impressum : undefined, ust_id: typeof o.ust_id === "string" ? o.ust_id : undefined };
    return { me, canEdit: me.role === "owner", settingsByKey, business, team, loading, error, reload, writeKey };
  }, [me, settings, team, loading, error, reload, writeKey]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSettings outside SettingsProvider");
  return v;
}
