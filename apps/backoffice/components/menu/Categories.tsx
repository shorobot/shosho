"use client";

// Kategorien panel of BO · Speisekarte: kana + item count, drag to sort (persisted as `sort`),
// create / rename / deactivate and the `schedule` editor for the lunch window (§1.2).
import { useMemo, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { Chips, Label, Row, Switch, TextField } from "@/components/menu/Fields";
import { useI18n, type Key } from "@/lib/i18n";
import { daysLabel, isValidSchedule, parseSchedule, reorder, slugify, sortValues, uniqueSlug, type Schedule } from "@/lib/menu";
import { run, useMenu } from "@/lib/menuStore";
import { toast } from "@/lib/toast";
import type { MenuCategoryRow } from "@/lib/types";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function weekdayNames(t: (k: Key) => string): string[] {
  return WEEKDAYS.map((d) => t(`wd.${d}` as Key));
}

export function Categories({ selected, onSelect, onCreateItem }: { selected: string | null; onSelect: (id: string | null) => void; onCreateItem: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { categories, countByCategory, canWrite, reload, items } = useMenu();
  const [editing, setEditing] = useState<MenuCategoryRow | "new" | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  // While a drag is in flight the panel renders the optimistic order; afterwards the store's order.
  const list = useMemo(() => {
    if (!order) return categories;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const moved = order.map((id) => byId.get(id)).filter((c): c is MenuCategoryRow => Boolean(c));
    return moved.length === categories.length ? moved : categories;
  }, [categories, order]);

  const scheduled = list.filter((c) => parseSchedule(c.schedule));

  async function persistOrder(next: MenuCategoryRow[]) {
    setOrder(next.map((c) => c.id));
    const sorts = sortValues(next.length);
    const rows = next.map((c, i) => ({ ...c, sort: sorts[i] as number }));
    const saved = await run(lang, () => supabase.from("menu_categories").upsert(rows).select("id"));
    if (saved) toast(t("cat.sorted"), "ok");
    await reload();
    setOrder(null);
  }

  function onDrop(to: number) {
    if (dragging == null || dragging === to) return setDragging(null);
    void persistOrder(reorder(list, dragging, to));
    setDragging(null);
  }

  return (
    <aside className="flex w-full flex-col gap-3 lg:w-[240px] lg:flex-none">
      <div className="card flex flex-col gap-2 rounded-[18px] p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-extrabold">{t("cat.title")}</h2>
          {canWrite && (
            <button type="button" onClick={() => setEditing("new")} className="text-[11px] font-extrabold text-orange transition-micro hover:brightness-110">
              {t("cat.new")}
            </button>
          )}
        </div>
        {canWrite && categories.length > 1 && <span className="text-[10px] text-muted">{t("cat.dragHint")}</span>}

        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`flex items-center justify-between gap-2 rounded-[12px] px-2.5 py-2 text-left transition-micro ${selected === null ? "bg-field" : "hover:bg-field-2"}`}
        >
          <span className="text-[13px] font-extrabold">{t("cat.all")}</span>
          <span className="text-[11px] text-muted">{items.length}</span>
        </button>

        {list.length === 0 && <span className="px-2.5 py-3 text-[12px] leading-[1.5] text-muted">{t("cat.noneBody")}</span>}

        <ul className="flex flex-col gap-0.5">
          {list.map((c, i) => {
            const count = countByCategory.get(c.id) ?? 0;
            const on = selected === c.id;
            return (
              <li
                key={c.id}
                draggable={canWrite}
                onDragStart={() => setDragging(i)}
                onDragOver={(e) => canWrite && e.preventDefault()}
                onDrop={() => onDrop(i)}
                onDragEnd={() => setDragging(null)}
                className={`group flex items-center gap-1.5 rounded-[12px] transition-micro ${on ? "bg-field" : "hover:bg-field-2"} ${dragging === i ? "opacity-45" : ""}`}
              >
                {canWrite && <span className="cursor-grab pl-2 text-[12px] text-muted-3 select-none" aria-hidden>⠿</span>}
                <button type="button" onClick={() => onSelect(c.id)} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 py-2 pl-1 pr-1 text-left">
                  <span className={`truncate text-[13px] font-extrabold ${c.active ? "" : "text-muted"}`}>{lang === "de" ? c.name_de : c.name_en}</span>
                  <span className="flex items-center gap-1.5 text-[11px] text-muted">
                    {c.name_ja && <span className="kana">{c.name_ja}</span>}
                    <span>· {count}</span>
                    {!c.active && <span className="rounded bg-field px-1 py-px text-[9px] font-extrabold tracking-[0.06em] text-muted">{t("cat.inactive")}</span>}
                    {parseSchedule(c.schedule) && <span title={t("cat.scheduleTitle")}>◷</span>}
                    {c.active && count === 0 && <span title={t("cat.emptyTitle")}>◌</span>}
                  </span>
                </button>
                {canWrite && (
                  <button type="button" onClick={() => setEditing(c)} aria-label={t("mi.edit")} className="px-2 py-2 text-[11px] text-muted opacity-0 transition-micro group-hover:opacity-100 focus-visible:opacity-100">
                    ✎
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card flex flex-col gap-1.5 rounded-[18px] p-4">
        <Label>{t("cat.scheduleTitle")}</Label>
        {scheduled.length === 0 ? (
          <span className="text-[11px] text-muted">{t("cat.scheduleNone")}</span>
        ) : (
          scheduled.map((c) => {
            const s = parseSchedule(c.schedule) as Schedule;
            return (
              <span key={c.id} className="text-[12px] leading-[1.5] text-ink-3">
                {t("cat.scheduleLine", { c: lang === "de" ? c.name_de : c.name_en, d: daysLabel(s.days, weekdayNames(t)), t: s.until })}
              </span>
            );
          })
        )}
      </div>

      {selected && (countByCategory.get(selected) ?? 0) === 0 && canWrite && (
        <div className="card flex flex-col gap-2.5 rounded-[18px] p-4 text-center">
          <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-field-2 text-[16px] text-muted shadow-(--shadow-inset)" aria-hidden>☰</span>
          <span className="text-[13px] font-extrabold">{t("cat.emptyTitle")}</span>
          <span className="text-[11px] leading-[1.5] text-ink-3">{t("cat.emptyBody", { c: nameOf(categories, selected, lang) })}</span>
          <Pill size="sm" onClick={onCreateItem}>
            {t("cat.emptyCta")}
          </Pill>
        </div>
      )}

      {editing && <CategoryDialog category={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </aside>
  );
}

function nameOf(categories: MenuCategoryRow[], id: string, lang: "de" | "en"): string {
  const c = categories.find((x) => x.id === id);
  return c ? (lang === "de" ? c.name_de : c.name_en) : "";
}

function CategoryDialog({ category, onClose }: { category: MenuCategoryRow | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { categories, reload } = useMenu();
  const existing = parseSchedule(category?.schedule ?? null);
  const [nameDe, setNameDe] = useState(category?.name_de ?? "");
  const [nameEn, setNameEn] = useState(category?.name_en ?? "");
  const [nameJa, setNameJa] = useState(category?.name_ja ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [active, setActive] = useState(category?.active ?? true);
  const [hasSchedule, setHasSchedule] = useState(Boolean(existing));
  const [days, setDays] = useState<number[]>(existing?.days ?? [1, 2, 3, 4, 5]);
  const [until, setUntil] = useState(existing?.until ?? "15:00");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = weekdayNames(t);

  async function save() {
    if (!nameDe.trim() || !nameEn.trim()) return setError(t("cat.nameRequired"));
    const schedule: Schedule | null = hasSchedule ? { days: [...days].sort((a, b) => a - b), until } : null;
    if (schedule && !isValidSchedule(schedule)) return setError(t("cat.scheduleInvalid"));
    setError(null);
    setBusy(true);
    const base = { name_de: nameDe.trim(), name_en: nameEn.trim(), name_ja: nameJa.trim() || null, active, schedule };
    const result = category
      ? await run(lang, () => supabase.from("menu_categories").update({ ...base, slug: slug.trim() || category.slug }).eq("id", category.id).select("id"))
      : await run(lang, () =>
          supabase
            .from("menu_categories")
            .insert({ ...base, slug: uniqueSlug(slug.trim() || slugify(nameEn || nameDe), categories.map((c) => c.slug)), sort: (categories.length + 1) * 10 })
            .select("id"),
        );
    setBusy(false);
    if (!result) return;
    toast(t("cat.saved"), "ok");
    await reload();
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={category ? t("cat.editTitle") : t("cat.newTitle")}>
      <div className="flex flex-col gap-3.5">
        <Row>
          <TextField label={t("cat.nameDe")} value={nameDe} onChange={setNameDe} />
          <TextField label={t("cat.nameEn")} value={nameEn} onChange={setNameEn} />
        </Row>
        <Row>
          <TextField label={t("cat.nameJa")} value={nameJa} onChange={setNameJa} kana placeholder="ロール" />
          <TextField label={t("cat.slug")} value={slug} onChange={(v) => setSlug(slugify(v))} hint={t("cat.slugHint")} placeholder={slugify(nameEn || nameDe)} />
        </Row>
        <Switch checked={active} onChange={setActive} label={t("cat.active")} hint={t("cat.activeHint")} />
        <Switch checked={hasSchedule} onChange={setHasSchedule} label={t("cat.schedule")} hint={t("cat.scheduleHint")} />
        {hasSchedule && (
          <div className="flex flex-col gap-2.5 rounded-[14px] bg-field-2 p-3.5">
            <Chips
              values={WEEKDAYS}
              selected={days}
              onToggle={(d) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]))}
              render={(d) => names[d - 1]}
            />
            <label className="flex max-w-[160px] flex-col gap-1.5">
              <Label>{t("cat.until")}</Label>
              <input type="time" className="field" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
          </div>
        )}
        {error && <span className="text-[12px] font-extrabold text-alert">{error}</span>}
        <div className="flex justify-end gap-2">
          <Pill variant="ghost" size="sm" onClick={onClose}>
            {t("bulk.cancel")}
          </Pill>
          <Pill size="sm" onClick={save} disabled={busy}>
            {busy ? t("ie.saving") : t("ie.save")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}
