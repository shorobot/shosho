"use client";

// One load of everything BO · Website edits (api-contracts §8.6 / §8.7). Reads are plain PostgREST
// selects; writes go through `run()` so an RLS denial surfaces as a German sentence instead of a
// raw Postgres error — the same pattern as menuStore/crmStore.
//
// THREE DIFFERENT WRITE RIGHTS MEET ON THIS ONE SCREEN, which is why they are named separately
// rather than collapsed into one `canWrite`:
//   · `settings`        — OWNER only (`settings_owner_write`). An operator sees the fields read-only.
//   · `banners`, zones  — owner/operator (`banners_staff_all`, `zones_staff_write`).
//   · `publish_site()`  — OWNER only, guarded inside the function (§8.7).
// An operator therefore stages banner edits and cannot publish them, which is a real workflow and
// not a bug; the screen says so where the publish button is.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { translate, type Key, type Lang } from "@/lib/i18n";
import { run as guardedRun } from "@/lib/menuStore";
import { toast } from "@/lib/toast";
import { pendingChanges, type BannerRow, type PendingChange, type PublicationRow, type SettingsRow, type ZoneRow } from "@/lib/site";
import { wrote } from "@/lib/write";
import type { Json, Staff, StaffDirectoryRow } from "@/lib/types";

/** Website copy for a failed write, so a denial does not talk about the menu. */
const SITE_KEYS: { denied: Key; saveError: Key } = { denied: "web.denied", saveError: "web.saveError" };

export function run<R extends { data: unknown; error: { code?: string; message?: string } | null }>(
  lang: Lang,
  op: () => PromiseLike<R>,
) {
  return guardedRun(lang, op as never, SITE_KEYS);
}

export type SiteData = {
  me: Staff;
  /** `settings` is owner-write; an operator gets a read-only form, not a Postgres error. */
  canEditSettings: boolean;
  /** Banners and zones are owner/operator. */
  canEditContent: boolean;
  /** `publish_site()` raises 42501 for anyone but the owner (§8.7). */
  canPublish: boolean;
  settings: SettingsRow[];
  banners: BannerRow[];
  zones: ZoneRow[];
  publications: PublicationRow[];
  staff: StaffDirectoryRow[];
  loading: boolean;
  error: string | null;
  /** One clock for the whole subtree, so two banner rows cannot disagree about "now". */
  now: Date;
  pending: PendingChange[];
  settingsByKey: Map<string, SettingsRow>;
  reload: () => Promise<void>;
  /** Stage (or clear) a settings draft. Returns true when the write landed. */
  stageSetting: (lang: Lang, key: string, draft: Json | null) => Promise<boolean>;
  publish: (lang: Lang) => Promise<Json | null>;
};

const Ctx = createContext<SiteData | null>(null);

export function SiteProvider({ me, children }: { me: Staff; children: ReactNode }) {
  const supabase = useSupabase();
  const [settings, setSettings] = useState<SettingsRow[]>([]);
  const [banners, setBanners] = useState<BannerRow[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [publications, setPublications] = useState<PublicationRow[]>([]);
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const reload = useCallback(async () => {
    setLoading(true);
    const [st, bn, zn, pb, dir] = await Promise.all([
      // `draft` is selected deliberately and only here: this client is an authenticated staff
      // session, which `settings`' table-level grant still covers. The anon role has no grant on
      // this column at all (§8.7) — nothing on this screen widens that.
      supabase.from("settings").select("*").order("key"),
      supabase.from("banners").select("*").order("slot").order("sort"),
      supabase.from("delivery_zones").select("*").order("code"),
      supabase.from("site_publications").select("*").order("at", { ascending: false }).limit(25),
      supabase.from("staff_directory").select("*"),
    ]);
    setError(st.error?.message ?? bn.error?.message ?? zn.error?.message ?? pb.error?.message ?? dir.error?.message ?? null);
    setSettings(st.data ?? []);
    setBanners(bn.data ?? []);
    setZones(zn.data ?? []);
    setPublications(pb.data ?? []);
    setStaff(dir.data ?? []);
    setNow(new Date());
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const stageSetting = useCallback(
    async (lang: Lang, key: string, draft: Json | null) => {
      // `.select("key")` is what makes the no-op detectable: an operator's update is RLS-filtered to
      // zero rows and returns `[]` with no error (lib/write.ts). Without this check the screen would
      // report a save that never happened.
      const res = await run(lang, () => supabase.from("settings").update({ draft }).eq("key", key).select("key"));
      if (res == null) return false;
      if (!wrote(res)) {
        toast(translate(lang, "web.settingNoop"));
        return false;
      }
      await reload();
      return true;
    },
    [supabase, reload],
  );

  const publish = useCallback(
    async (lang: Lang) => {
      const res = await run(lang, () => supabase.rpc("publish_site"));
      if (res == null) return null;
      await reload();
      return res as Json;
    },
    [supabase, reload],
  );

  const value = useMemo<SiteData>(() => {
    const settingsByKey = new Map(settings.map((s) => [s.key, s]));
    return {
      me,
      canEditSettings: me.role === "owner",
      canEditContent: me.role === "owner" || me.role === "operator",
      canPublish: me.role === "owner",
      settings,
      banners,
      zones,
      publications,
      staff,
      loading,
      error,
      now,
      pending: pendingChanges(settings, banners),
      settingsByKey,
      reload,
      stageSetting,
      publish,
    };
  }, [me, settings, banners, zones, publications, staff, loading, error, now, reload, stageSetting, publish]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSite(): SiteData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSite outside SiteProvider");
  return v;
}
