"use client";

// Optionsgruppen (§1.2 `option_groups` / `options`). Shared groups are listed with their usage
// count and, exactly as the design says, editing one warns that every linked item changes with it.
// Item-only groups (`shared = false`) are edited inside the Artikel editor and never listed here.
import { useMemo, useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { Label, MoneyField, Row, Select, Switch, TextField } from "@/components/menu/Fields";
import { useI18n, type Key } from "@/lib/i18n";
import { ruleOf, ruleShape, validateGroup, type GroupError, type GroupRule } from "@/lib/menu";
import { run, useMenu } from "@/lib/menuStore";
import { euro } from "@/lib/money";
import { toast } from "@/lib/toast";
import type { OptionGroup, OptionRow } from "@/lib/types";

export function ruleLabel(t: (k: Key, v?: Record<string, string | number>) => string, g: { min_select: number; max_select: number | null }): string {
  const rule = ruleOf(g);
  if (rule === "any") return t("og.rule.any");
  if (rule === "one") return t("og.rule.one");
  return g.max_select == null ? t("og.rule.rangeOpen", { a: g.min_select }) : t("og.rule.range", { a: g.min_select, b: g.max_select });
}

export function OptionGroupsPanel({ compact = false }: { compact?: boolean }) {
  const { t, lang } = useI18n();
  const { groups, usageByGroup, canWrite } = useMenu();
  const [editing, setEditing] = useState<OptionGroup | "new" | null>(null);
  const shared = groups.filter((g) => g.shared);

  return (
    <section className={`card flex flex-col gap-3 rounded-[18px] p-4 ${compact ? "" : "p-5"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-extrabold">{t("og.title")}</h2>
        {canWrite && (
          <button type="button" onClick={() => setEditing("new")} className="text-[11px] font-extrabold text-orange transition-micro hover:brightness-110">
            {t("og.new")}
          </button>
        )}
      </div>

      {shared.length === 0 ? (
        <EmptyState icon="☰" title={t("og.noneTitle")} body={t("og.noneBody")} action={canWrite ? <Pill size="sm" onClick={() => setEditing("new")}>{t("og.new")}</Pill> : undefined} />
      ) : (
        <ul className="flex flex-col gap-1">
          {shared.map((g) => {
            const used = usageByGroup.get(g.id) ?? 0;
            return (
              <li key={g.id} className="group flex items-center gap-2 rounded-[12px] px-2.5 py-2 transition-micro hover:bg-field-2">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-extrabold">{lang === "de" ? g.name_de : g.name_en}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                    <span className="rounded bg-sky-tint px-1.5 py-px font-extrabold tracking-[0.06em] text-ink-2">{t("og.shared")}</span>
                    <span>{used ? t("og.usage", { n: used }) : t("og.usageNone")}</span>
                    <span>· {t("og.count", { n: g.options.length })}</span>
                    <span>· {ruleLabel(t, g)}</span>
                    {g.required && <span>· {t("og.required")}</span>}
                  </span>
                </span>
                {canWrite && (
                  <button type="button" onClick={() => setEditing(g)} aria-label={t("mi.edit")} className="px-2 text-[11px] text-muted opacity-0 transition-micro group-hover:opacity-100 focus-visible:opacity-100">
                    ✎
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="rounded-[12px] bg-sky-tint px-3 py-2.5 text-[11px] leading-[1.45] text-ink-2">{t("og.note")}</div>

      {editing && <OptionGroupDialog group={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

type Draft = {
  name_de: string;
  name_en: string;
  shared: boolean;
  min_select: number;
  max_select: number | null;
  required: boolean;
  options: { id?: string; name_de: string; name_en: string; price_cents: number; active: boolean; sort: number }[];
  removed: string[];
};

function draftOf(group: OptionGroup | null, forceOwn: boolean): Draft {
  return {
    name_de: group?.name_de ?? "",
    name_en: group?.name_en ?? "",
    shared: group ? group.shared : !forceOwn,
    min_select: group?.min_select ?? 0,
    max_select: group?.max_select ?? null,
    required: group?.required ?? false,
    options: (group?.options ?? []).map((o) => ({ id: o.id, name_de: o.name_de, name_en: o.name_en, price_cents: o.price_cents, active: o.active, sort: o.sort })),
    removed: [],
  };
}

/**
 * Create / edit one group with its options. `onSaved` lets the item editor link a freshly created
 * own group straight away. Saving a shared group asks first and names the number of linked items.
 */
export function OptionGroupDialog({
  group, onClose, forceOwn = false, onSaved,
}: {
  group: OptionGroup | null; onClose: () => void; forceOwn?: boolean; onSaved?: (groupId: string) => void;
}) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { usageByGroup, reload } = useMenu();
  const [d, setD] = useState<Draft>(() => draftOf(group, forceOwn));
  const [errors, setErrors] = useState<GroupError[]>([]);
  const [confirmShared, setConfirmShared] = useState(false);
  const [busy, setBusy] = useState(false);

  const usage = group ? usageByGroup.get(group.id) ?? 0 : 0;
  const rule = useMemo<GroupRule>(() => ruleOf(d), [d]);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  function validate(): boolean {
    const e = validateGroup({ ...d, options: d.options.filter((o) => o.active || o.id) });
    setErrors(e);
    return e.length === 0;
  }

  async function save() {
    if (!validate()) return;
    // The design's warning: a shared group is not edited in isolation.
    if (d.shared && usage > 0 && !confirmShared) return setConfirmShared(true);
    setBusy(true);
    const head = { name_de: d.name_de.trim(), name_en: (d.name_en || d.name_de).trim(), shared: d.shared, min_select: d.min_select, max_select: d.max_select, required: d.required };
    const saved = group
      ? await run(lang, () => supabase.from("option_groups").update(head).eq("id", group.id).select("id").single())
      : await run(lang, () => supabase.from("option_groups").insert(head).select("id").single());
    if (!saved) return setBusy(false);
    const groupId = saved.id;

    if (d.removed.length) await run(lang, () => supabase.from("options").delete().in("id", d.removed).select("id"));
    const rows = d.options.map((o, i) => ({ ...(o.id ? { id: o.id } : {}), group_id: groupId, name_de: o.name_de.trim(), name_en: (o.name_en || o.name_de).trim(), price_cents: o.price_cents, active: o.active, sort: (i + 1) * 10 }));
    if (rows.length) {
      const ok = await run(lang, () => supabase.from("options").upsert(rows).select("id"));
      if (!ok) return setBusy(false);
    }
    setBusy(false);
    toast(t("og.saved"), "ok");
    await reload();
    onSaved?.(groupId);
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={group ? t("og.editTitle") : t("og.newTitle")} wide>
      <div className="flex flex-col gap-3.5">
        <Row>
          <TextField label={t("og.nameDe")} value={d.name_de} onChange={(v) => set({ name_de: v })} error={errors.includes("name") ? t("og.err.name") : undefined} />
          <TextField label={t("og.nameEn")} value={d.name_en} onChange={(v) => set({ name_en: v })} />
        </Row>

        <Row cols={3}>
          <Select<GroupRule>
            label={t("og.rule")}
            value={rule}
            onChange={(r) => set(ruleShape(r, d))}
            options={[
              { value: "any", label: t("og.rule.any") },
              { value: "one", label: t("og.rule.one") },
              { value: "range", label: t("og.rule.range", { a: 0, b: 3 }) },
            ]}
          />
          {rule === "range" && (
            <>
              <label className="flex flex-col gap-1.5">
                <Label>{t("og.min")}</Label>
                <input type="number" min={0} className="field" value={d.min_select} onChange={(e) => set({ min_select: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
              </label>
              <label className="flex flex-col gap-1.5">
                <Label>{t("og.max")}</Label>
                <input type="number" min={1} className="field" placeholder={t("og.maxNone")} value={d.max_select ?? ""} onChange={(e) => set({ max_select: e.target.value === "" ? null : Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} />
              </label>
            </>
          )}
        </Row>
        {errors.includes("range") && <span className="text-[11px] font-extrabold text-alert">{t("og.err.range")}</span>}
        {errors.includes("required_min") && <span className="text-[11px] font-extrabold text-alert">{t("og.err.required_min")}</span>}

        <Switch checked={d.required} onChange={(v) => set({ required: v })} label={t("og.requiredLabel")} />
        <Switch checked={d.shared} onChange={(v) => set({ shared: v })} label={t("og.sharedLabel")} hint={t("og.sharedHint")} disabled={forceOwn && !group} />

        <div className="flex flex-col gap-2">
          <Label>{t("og.options")}</Label>
          {d.options.map((o, i) => (
            <div key={o.id ?? `new-${i}`} className="flex flex-wrap items-end gap-2 rounded-[14px] bg-field-2 p-2.5">
              <div className="min-w-[150px] flex-1">
                <TextField label={t("og.optionName")} value={o.name_de} onChange={(v) => set({ options: d.options.map((x, k) => (k === i ? { ...x, name_de: v } : x)) })} />
              </div>
              <div className="min-w-[120px] flex-1">
                <TextField label="EN" value={o.name_en} onChange={(v) => set({ options: d.options.map((x, k) => (k === i ? { ...x, name_en: v } : x)) })} />
              </div>
              <div className="w-[120px]">
                <MoneyField label={t("og.optionPrice")} cents={o.price_cents} onChange={(c) => set({ options: d.options.map((x, k) => (k === i ? { ...x, price_cents: c ?? 0 } : x)) })} />
              </div>
              <button
                type="button"
                aria-label={t("ph.remove")}
                onClick={() => set({ options: d.options.filter((_, k) => k !== i), removed: o.id ? [...d.removed, o.id] : d.removed })}
                className="mb-2.5 px-2 text-[13px] text-muted transition-micro hover:text-alert"
              >
                ✕
              </button>
            </div>
          ))}
          {errors.includes("no_options") && <span className="text-[11px] font-extrabold text-alert">{t("og.err.no_options")}</span>}
          {errors.includes("option_name") && <span className="text-[11px] font-extrabold text-alert">{t("og.err.option_name")}</span>}
          {errors.includes("option_price") && <span className="text-[11px] font-extrabold text-alert">{t("og.err.option_price")}</span>}
          <Pill variant="ghost" size="xs" className="self-start" onClick={() => set({ options: [...d.options, { name_de: "", name_en: "", price_cents: 0, active: true, sort: (d.options.length + 1) * 10 }] })}>
            {t("og.optionAdd")}
          </Pill>
        </div>

        {confirmShared && (
          <div className="rounded-[14px] border-l-[5px] border-orange-ink bg-orange-tint p-3.5">
            <span className="block text-[13px] font-extrabold">{t("og.warnTitle")}</span>
            <span className="mt-1 block text-[12px] leading-[1.5] text-ink-3">{t("og.warnBody", { g: d.name_de, n: usage })}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Pill variant="ghost" size="sm" onClick={onClose}>
            {t("bulk.cancel")}
          </Pill>
          <Pill size="sm" onClick={save} disabled={busy}>
            {busy ? t("ie.saving") : confirmShared ? t("og.warnConfirm") : t("ie.save")}
          </Pill>
        </div>
      </div>
    </Modal>
  );
}

/** Read-only summary line used by the item editor's Optionen section. */
export function GroupSummary({ group }: { group: OptionGroup & { options: OptionRow[] } }) {
  const { t, lang } = useI18n();
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[13px] font-extrabold">{lang === "de" ? group.name_de : group.name_en}</span>
      <span className="text-[11px] text-muted">
        {ruleLabel(t, group)} · {t("og.count", { n: group.options.length })}
        {group.required ? ` · ${t("og.required")}` : ""}
        {group.options.some((o) => o.price_cents > 0) ? ` · ${euro(Math.min(...group.options.filter((o) => o.price_cents > 0).map((o) => o.price_cents)), lang)}+` : ""}
      </span>
    </span>
  );
}
