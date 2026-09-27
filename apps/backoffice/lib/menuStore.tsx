"use client";

// One load of the whole menu for every screen under /menu (list, item editor, option groups).
// Reads are plain PostgREST selects (§6.5); writes go through `run()` so an RLS denial always
// surfaces as the same German sentence instead of a raw Postgres error.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PostgrestError } from "@supabase/supabase-js";
import { useSupabase } from "@/components/providers/EnvProvider";
import { translate, type Lang } from "@/lib/i18n";
import { toast } from "@/lib/toast";
import { dayKey } from "@/lib/time";
import type { ItemOptionGroupRow, MenuCategoryRow, MenuItemRow, OptionGroup, Staff } from "@/lib/types";

export type MenuData = {
  me: Staff;
  canWrite: boolean;
  categories: MenuCategoryRow[];
  items: MenuItemRow[];
  groups: OptionGroup[];
  links: ItemOptionGroupRow[];
  loading: boolean;
  error: string | null;
  today: string;
  reload: () => Promise<void>;
  /** Items per category id — the counts next to the category names. */
  countByCategory: Map<string, number>;
  /** Linked-item count per option group id — "GEMEINSAM · 8 ARTIKEL". */
  usageByGroup: Map<string, number>;
};

const Ctx = createContext<MenuData | null>(null);

/** True when Postgres refused the write because of RLS (or a plain permission error). */
export function isDenied(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "");
}

/**
 * Wrap a write: returns the data or null, and reports the failure once. `lang` keeps the message in
 * the language the operator is reading.
 */
/**
 * PostgREST answers with a discriminated union (`{data, error: null} | {data: null, error}`), so the
 * payload type is pulled out of the whole response rather than inferred from one member.
 */
type Response = { data: unknown; error: PostgrestError | null };
type Payload<R> = R extends { data: infer D } ? Exclude<D, null> : never;

export async function run<R extends Response>(lang: Lang, op: () => PromiseLike<R>): Promise<Payload<R> | null> {
  const { data, error } = await op();
  if (error) {
    toast(isDenied(error) ? translate(lang, "menu.denied") : translate(lang, "menu.saveError", { e: error.message ?? "" }));
    return null;
  }
  return (data ?? null) as Payload<R> | null;
}

export function MenuProvider({ me, children }: { me: Staff; children: ReactNode }) {
  const supabase = useSupabase();
  const [categories, setCategories] = useState<MenuCategoryRow[]>([]);
  const [items, setItems] = useState<MenuItemRow[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [links, setLinks] = useState<ItemOptionGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [cats, its, grps, lks] = await Promise.all([
      supabase.from("menu_categories").select("*").order("sort").order("name_de"),
      supabase.from("menu_items").select("*").order("sort").order("name_de"),
      supabase.from("option_groups").select("*, options(*)").order("name_de"),
      supabase.from("menu_item_option_groups").select("*").order("sort"),
    ]);
    const first = cats.error ?? its.error ?? grps.error ?? lks.error;
    setError(first?.message ?? null);
    setCategories(cats.data ?? []);
    setItems(its.data ?? []);
    setGroups(((grps.data ?? []) as OptionGroup[]).map((g) => ({ ...g, options: [...(g.options ?? [])].sort((a, b) => a.sort - b.sort) })));
    setLinks(lks.data ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<MenuData>(() => {
    const countByCategory = new Map<string, number>();
    for (const i of items) countByCategory.set(i.category_id, (countByCategory.get(i.category_id) ?? 0) + 1);
    const usageByGroup = new Map<string, number>();
    for (const l of links) usageByGroup.set(l.group_id, (usageByGroup.get(l.group_id) ?? 0) + 1);
    return {
      me,
      canWrite: me.role === "owner" || me.role === "operator",
      categories,
      items,
      groups,
      links,
      loading,
      error,
      today: dayKey(new Date()),
      reload,
      countByCategory,
      usageByGroup,
    };
  }, [me, categories, items, groups, links, loading, error, reload]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMenu(): MenuData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMenu outside MenuProvider");
  return v;
}
