"use client";

// Delivery zones (§1.1 `delivery_zones`). The design puts them on this screen, and the numbers here
// are the ones the storefront quotes — minimum order, fee, promised minutes.
//
// THEY ARE NOT PART OF THE STAGED PUBLISH, and the panel says so out loud. `delivery_zones` is its
// own table with no `draft` column: §8.7 added `draft` to `settings` and `banners` only. A zone edit
// is therefore live the moment it is saved. The boot described zones as going "through settings keys,
// all into draft" — they do not, and pretending otherwise would have been the one mistake on this
// screen an operator could not see. Reported as a §8.7 contract gap.
import { useState } from "react";
import { useSupabase } from "@/components/providers/EnvProvider";
import { MoneyField, NumberField, Row, Section, Switch, TextArea, TextField } from "@/components/menu/Fields";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { useI18n } from "@/lib/i18n";
import { euro } from "@/lib/money";
import { formatPostalCodes, parsePostalCodes, type ZoneRow } from "@/lib/site";
import { run, useSite } from "@/lib/siteStore";
import { toast } from "@/lib/toast";
import { wrote } from "@/lib/write";

type ZoneForm = {
  code: string;
  name: string;
  areas: string;
  min_order_cents: number;
  fee_cents: number;
  free_delivery_over_cents: number | null;
  promised_minutes: number;
  postal_codes: string;
  active: boolean;
};

function formOf(z: ZoneRow | null): ZoneForm {
  return {
    code: z?.code ?? "",
    name: z?.name ?? "",
    areas: z?.areas ?? "",
    min_order_cents: z?.min_order_cents ?? 0,
    fee_cents: z?.fee_cents ?? 0,
    free_delivery_over_cents: z?.free_delivery_over_cents ?? null,
    promised_minutes: z?.promised_minutes ?? 60,
    postal_codes: formatPostalCodes(z?.postal_codes),
    active: z?.active ?? true,
  };
}

export function ZonesPanel() {
  const { t, lang } = useI18n();
  const { zones, canEditContent } = useSite();
  const [editing, setEditing] = useState<ZoneRow | "new" | null>(null);

  return (
    <>
      <Section title={t("web.zones")} hint={t("web.zonesImmediate")}>
        {zones.length === 0 ? (
          <EmptyState
            icon="◉"
            title={t("web.zonesEmptyTitle")}
            body={t("web.zonesEmptyBody")}
            action={canEditContent ? <Pill size="sm" onClick={() => setEditing("new")}>{t("web.addZone")}</Pill> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[640px] flex flex-col gap-1.5">
              <div className="grid grid-cols-[56px_1fr_104px_96px_84px_92px_56px] gap-2 px-2 pb-1">
                {[t("web.zoneCode"), t("web.colArea"), t("web.colMin"), t("web.colFee"), t("web.colTime"), t("web.colPostal"), t("web.colActive")].map((h) => (
                  <span key={String(h)} className="label-caps">
                    {h}
                  </span>
                ))}
              </div>
              {zones.map((z) => (
                <button
                  key={z.id}
                  type="button"
                  onClick={() => setEditing(z)}
                  className="grid grid-cols-[56px_1fr_104px_96px_84px_92px_56px] items-center gap-2 rounded-[12px] bg-field-2 px-2 py-2.5 text-left transition-micro hover:bg-field"
                >
                  <span className="text-[13px] font-extrabold">{z.code}</span>
                  <span className="truncate text-[12px]">{z.areas || z.name}</span>
                  <span className="text-[12px]">{euro(z.min_order_cents, lang)}</span>
                  <span className="text-[12px]">{euro(z.fee_cents, lang)}</span>
                  <span className="text-[12px]">{t("kpi.min", { n: z.promised_minutes })}</span>
                  <span className="truncate text-[11px] text-muted">{(z.postal_codes ?? []).length || "—"}</span>
                  <Badge tone={z.active ? "ok" : "muted"}>{z.active ? t("web.state.live") : t("web.state.inactive")}</Badge>
                </button>
              ))}
              {canEditContent && (
                <button
                  type="button"
                  onClick={() => setEditing("new")}
                  className="rounded-[12px] border border-dashed border-line-3 bg-field-2 py-2 text-[12px] font-extrabold text-orange transition-micro hover:border-orange-line"
                >
                  {t("web.addZone")}
                </button>
              )}
            </div>
          </div>
        )}
      </Section>
      {editing && <ZoneEditor zone={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ZoneEditor({ zone, onClose }: { zone: ZoneRow | null; onClose: () => void }) {
  const { t, lang } = useI18n();
  const supabase = useSupabase();
  const { canEditContent, reload } = useSite();
  const [form, setForm] = useState<ZoneForm>(() => formOf(zone));
  const [busy, setBusy] = useState(false);
  const ro = !canEditContent;
  const set = <K extends keyof ZoneForm>(k: K, v: ZoneForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    if (!form.code.trim()) return toast(t("web.zoneCodeRequired"));
    setBusy(true);
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim() || form.code.trim().toUpperCase(),
      areas: form.areas.trim() || null,
      min_order_cents: form.min_order_cents,
      fee_cents: form.fee_cents,
      free_delivery_over_cents: form.free_delivery_over_cents,
      promised_minutes: Math.max(1, form.promised_minutes),
      postal_codes: parsePostalCodes(form.postal_codes),
      active: form.active,
    };
    const res = zone
      ? await run(lang, () => supabase.from("delivery_zones").update(payload).eq("id", zone.id).select("id"))
      : await run(lang, () => supabase.from("delivery_zones").insert(payload).select("id"));
    setBusy(false);
    if (res == null) return;
    if (!wrote(res)) return toast(t("web.writeNoop"));
    await reload();
    toast(t("web.zoneSaved"), "ok");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={zone ? t("web.zoneEdit") : t("web.zoneNew")} wide>
      <div className="flex flex-col gap-4">
        <span className="text-[12px] leading-[1.55] text-orange-ink">{t("web.zonesImmediate")}</span>
        <Row cols={2}>
          <TextField label={t("web.zoneCode")} value={form.code} disabled={ro} maxLength={8} onChange={(v) => set("code", v.toUpperCase())} />
          <TextField label={t("web.zoneName")} value={form.name} disabled={ro} onChange={(v) => set("name", v)} />
        </Row>
        <Row cols={1}>
          <TextField label={t("web.zoneAreas")} value={form.areas} disabled={ro} onChange={(v) => set("areas", v)} />
        </Row>
        <Row cols={4}>
          <MoneyField label={t("web.zoneMin")} cents={form.min_order_cents} disabled={ro} onChange={(c) => set("min_order_cents", c ?? 0)} />
          <MoneyField label={t("web.zoneFee")} cents={form.fee_cents} disabled={ro} onChange={(c) => set("fee_cents", c ?? 0)} />
          <MoneyField label={t("web.zoneFree")} cents={form.free_delivery_over_cents} nullable disabled={ro} onChange={(c) => set("free_delivery_over_cents", c)} />
          <NumberField label={t("web.zoneMinutes")} value={form.promised_minutes} min={1} suffix="Min" disabled={ro} onChange={(v) => set("promised_minutes", v ?? 60)} />
        </Row>
        <TextArea label={t("web.zonePostal")} value={form.postal_codes} rows={2} disabled={ro} onChange={(v) => set("postal_codes", v)} />
        <span className="text-[11px] text-muted">{t("web.zonePostalHint")}</span>
        <Switch checked={form.active} disabled={ro} onChange={(v) => set("active", v)} label={t("web.zoneActive")} />
        <div className="flex justify-end gap-2">
          <Pill variant="ghost" size="sm" onClick={onClose}>
            {t("web.cancel")}
          </Pill>
          {canEditContent && (
            <Pill size="sm" onClick={save} disabled={busy}>
              {t("web.save")}
            </Pill>
          )}
        </div>
      </div>
    </Modal>
  );
}
