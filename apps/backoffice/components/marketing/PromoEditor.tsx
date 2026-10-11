"use client";

// Promo code editor (§1.5). The table's CHECK constraints are mirrored in the form so a bad value is
// refused with a sentence instead of a Postgres error: `code = upper(code)`, `value > 0`, and for a
// percent code the 1..100 range the column comment documents.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { MoneyField, NumberField, Row, Select, Switch, TextField } from "@/components/menu/Fields";
import { DateTimeField } from "@/components/ui/DateTimeField";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { useI18n, type Key } from "@/lib/i18n";
import {
  appliesTo, normaliseCode, PROMO_SCOPES, validatePromo,
  type AppliesTo, type PromoKind, type PromoRow, type PromoScope,
} from "@/lib/marketing";
import { run, useMarketing } from "@/lib/marketingStore";
import { toast } from "@/lib/toast";
import type { Json } from "@/lib/types";
import { wrote } from "@/lib/write";

type Form = {
  code: string;
  kind: PromoKind;
  value: number | null;
  min_order_cents: number;
  scope: PromoScope;
  category_id: string | null;
  usage_limit: number | null;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
};

function formOf(p: PromoRow | null): Form {
  const a: AppliesTo = p ? appliesTo(p.applies_to) : { scope: "all" };
  return {
    code: p?.code ?? "",
    kind: p?.kind ?? "percent",
    value: p?.value ?? null,
    min_order_cents: p?.min_order_cents ?? 0,
    scope: a.scope ?? "all",
    category_id: a.category_id ?? null,
    usage_limit: p?.usage_limit ?? null,
    valid_from: p?.valid_from ?? null,
    valid_to: p?.valid_to ?? null,
    active: p?.active ?? true,
  };
}

export function PromoEditor({ promo, onClose }: { promo: PromoRow | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { categories, canWrite, reload } = useMarketing();
  const [form, setForm] = useState<Form>(() => formOf(promo));
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const ro = !canWrite;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const problems = validatePromo(form);

  async function save() {
    if (problems.length) {
      setShowErrors(true);
      return toast(problems.includes("code") ? t("mkt.promoBadCode") : t("mkt.promoBadValue"));
    }
    setBusy(true);
    const scope: Record<string, Json> = { scope: form.scope };
    if (form.scope === "category" && form.category_id) scope.category_id = form.category_id;
    // Day/time windows the seed uses (`days`, `until`) are preserved rather than dropped: this form
    // does not edit them, and a full `applies_to` replacement would silently delete them.
    const existing = promo ? appliesTo(promo.applies_to) : {};
    if (existing.days?.length) scope.days = existing.days;
    if (existing.until) scope.until = existing.until;

    const payload = {
      code: normaliseCode(form.code),
      kind: form.kind,
      value: form.value ?? 0,
      min_order_cents: form.min_order_cents,
      applies_to: scope as Json,
      usage_limit: form.usage_limit,
      valid_from: form.valid_from,
      valid_to: form.valid_to,
      active: form.active,
    };
    const res = promo
      ? await run(lang, () => supabase.from("promo_codes").update(payload).eq("id", promo.id).select("id"))
      : await run(lang, () => supabase.from("promo_codes").insert(payload).select("id"));
    setBusy(false);
    if (res == null) return;
    if (!wrote(res)) return toast(t("web.writeNoop"));
    await reload();
    toast(t("mkt.promoSaved"), "ok");
    onClose();
  }

  async function remove() {
    setBusy(true);
    const res = await run(lang, () => supabase.from("promo_codes").delete().eq("id", promo!.id).select("id"));
    setBusy(false);
    if (res == null) return;
    if (!wrote(res)) return toast(t("web.writeNoop"));
    await reload();
    toast(t("mkt.promoDeleted"), "ok");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={promo ? t("mkt.promoEdit") : t("mkt.promoNew")} wide>
      <div className="flex flex-col gap-4">
        <Row cols={3}>
          <TextField
            label={t("mkt.promoCode")}
            value={form.code}
            disabled={ro}
            hint={t("mkt.promoCodeHint")}
            error={showErrors && problems.includes("code") ? t("mkt.promoBadCode") : undefined}
            onChange={(v) => set("code", v.toUpperCase())}
          />
          <Select<PromoKind>
            label={t("mkt.promoKind")}
            value={form.kind}
            disabled={ro}
            onChange={(v) => set("kind", v)}
            options={(["percent", "fixed"] as PromoKind[]).map((k) => ({ value: k, label: t(`mkt.kind.${k}` as Key) }))}
          />
          {form.kind === "percent" ? (
            <NumberField
              label={t("mkt.promoValuePct")}
              value={form.value}
              min={1}
              suffix="%"
              disabled={ro}
              onChange={(v) => set("value", v)}
            />
          ) : (
            <MoneyField label={t("mkt.promoValueFixed")} cents={form.value} nullable disabled={ro} onChange={(c) => set("value", c)} />
          )}
        </Row>
        {showErrors && problems.includes("value") && <span className="text-[11px] font-extrabold text-alert">{t("mkt.promoBadValue")}</span>}

        <Row cols={3}>
          <MoneyField label={t("mkt.promoMin")} cents={form.min_order_cents} disabled={ro} onChange={(c) => set("min_order_cents", c ?? 0)} />
          <Select<PromoScope>
            label={t("mkt.promoScope")}
            value={form.scope}
            disabled={ro}
            onChange={(v) => set("scope", v)}
            options={PROMO_SCOPES.map((s) => ({ value: s, label: t(`mkt.scope.${s}` as Key, { c: "…" }) }))}
          />
          <NumberField label={t("mkt.promoLimit")} value={form.usage_limit} min={1} disabled={ro} onChange={(v) => set("usage_limit", v)} />
        </Row>
        {form.scope === "category" && (
          <Row cols={1}>
            <Select<string>
              label={t("mkt.promoCategory")}
              value={form.category_id ?? ""}
              disabled={ro}
              onChange={(v) => set("category_id", v || null)}
              options={[{ value: "", label: "—" }, ...categories.map((c) => ({ value: c.id, label: c.name_de }))]}
            />
          </Row>
        )}
        <span className="text-[11px] text-muted">{t("mkt.promoLimitHint")}</span>

        <Row cols={2}>
          <DateTimeField label={t("mkt.promoFrom")} value={form.valid_from} disabled={ro} onChange={(v) => set("valid_from", v)} />
          <DateTimeField label={t("mkt.promoTo")} value={form.valid_to} disabled={ro} min={form.valid_from} onChange={(v) => set("valid_to", v)} />
        </Row>
        <Switch checked={form.active} disabled={ro} onChange={(v) => set("active", v)} label={t("mkt.promoActive")} />
        {promo && <span className="text-[11px] text-muted">{t("mkt.promoUsed", { n: promo.used_count })}</span>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {promo && canWrite ? <DeletePromo code={promo.code} busy={busy} onConfirm={remove} /> : <span />}
          <div className="flex gap-2">
            <Pill variant="ghost" size="sm" onClick={onClose}>
              {t("web.cancel")}
            </Pill>
            {canWrite && (
              <Pill size="sm" onClick={save} disabled={busy}>
                {t("web.save")}
              </Pill>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DeletePromo({ code, busy, onConfirm }: { code: string; busy: boolean; onConfirm: () => Promise<void> }) {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Pill variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        {t("mkt.delete")}
      </Pill>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="max-w-[300px] text-[11px] leading-[1.45] text-alert">{t("mkt.promoDeleteConfirm", { c: code })}</span>
      <Pill variant="alert" size="xs" onClick={() => void onConfirm()} disabled={busy}>
        {t("mkt.delete")}
      </Pill>
      <Pill variant="ghost" size="xs" onClick={() => setConfirming(false)}>
        {t("web.cancel")}
      </Pill>
    </div>
  );
}
