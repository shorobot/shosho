"use client";

// Operations: settings.ops + settings['kitchen.status'].capacity (api-contracts §6.9 rows 1/6).
// Owner-write, takes effect on the next order immediately — no draft/publish step, unlike BO ·
// Website's keys (see lib/settingsStore.tsx's header comment for why).
import { useEffect, useState } from "react";
import { NumberField, Row, Switch } from "@/components/menu/Fields";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useI18n } from "@/lib/i18n";
import { kitchenStatusCapacityToJson, opsToJson, parseKitchenStatus, parseOps } from "@/lib/settings";
import { useSettings } from "@/lib/settingsStore";
import type { OpsSettings } from "@/lib/types";

export function OperationsPanel() {
  const { t, lang } = useI18n();
  const { settingsByKey, canEdit, writeKey } = useSettings();
  const opsRow = settingsByKey.get("ops");
  const kitchenStatusRow = settingsByKey.get("kitchen.status");
  const live = parseOps(opsRow?.value ?? {});
  const liveCapacity = parseKitchenStatus(kitchenStatusRow?.value ?? {}).capacity ?? 8;

  const [form, setForm] = useState<OpsSettings>(live);
  const [capacity, setCapacity] = useState(liveCapacity);
  const [busy, setBusy] = useState(false);

  // Re-sync when a reload brings fresher data in, but only while the operator hasn't typed anything.
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (dirty) return;
    setForm(live);
    setCapacity(liveCapacity);
    // `live`/`liveCapacity` are derived fresh every render from the store; comparing the row
    // directly is what actually signals "new data arrived".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opsRow?.value, kitchenStatusRow?.value, dirty]);

  async function save() {
    setBusy(true);
    const ok1 = await writeKey(lang, "ops", opsToJson(form, opsRow?.value ?? {}));
    const ok2 = await writeKey(lang, "kitchen.status", kitchenStatusCapacityToJson(capacity, kitchenStatusRow?.value ?? {}));
    setBusy(false);
    if (ok1 && ok2) setDirty(false);
  }

  const set = <K extends keyof OpsSettings>(k: K, v: OpsSettings[K]) => {
    setDirty(true);
    setForm((f) => ({ ...f, [k]: v }));
  };

  return (
    <SettingsSection title={t("set.ops")} hint={t("set.opsHint")} canEdit={canEdit} dirty={dirty} busy={busy} onSave={() => void save()}>
      <Row cols={3}>
        <NumberField label={t("set.opsPrep")} value={form.prep_default_min ?? null} onChange={(v) => set("prep_default_min", v ?? undefined)} suffix={t("set.minutes")} disabled={!canEdit} />
        <NumberField label={t("set.opsRush")} value={form.rush_extra_min ?? null} onChange={(v) => set("rush_extra_min", v ?? undefined)} suffix={t("set.minutes")} disabled={!canEdit} />
        <NumberField label={t("set.opsPreorder")} value={form.preorder_max_days ?? null} onChange={(v) => set("preorder_max_days", v ?? undefined)} suffix={t("set.days")} disabled={!canEdit} />
      </Row>
      <Row cols={3}>
        <NumberField
          label={t("set.opsAutoAccept")}
          value={form.auto_accept_paid_under_cents != null ? Math.round(form.auto_accept_paid_under_cents / 100) : null}
          onChange={(v) => set("auto_accept_paid_under_cents", v == null ? undefined : v * 100)}
          suffix="€"
          disabled={!canEdit}
        />
        <NumberField label={t("set.opsPickupDiscount")} value={form.pickup_discount_pct ?? null} onChange={(v) => set("pickup_discount_pct", v ?? undefined)} suffix={t("set.percent")} disabled={!canEdit} />
        <NumberField
          label={t("set.opsCapacity")}
          value={capacity}
          onChange={(v) => {
            setDirty(true);
            setCapacity(v ?? 8);
          }}
          min={1}
          disabled={!canEdit}
        />
      </Row>
      <Switch checked={form.pause_allowed ?? false} onChange={(v) => set("pause_allowed", v)} label={t("set.opsPause")} disabled={!canEdit} />
      <span className="text-[11px] leading-[1.4] text-muted">{t("set.opsCapacityHint")}</span>
    </SettingsSection>
  );
}
