"use client";

// Notifications. "Sound on new order" already exists, per-device, in BO · Orders' header
// (lib/sound.ts, localStorage — not a `settings` row, so it is not owner-gated and not part of this
// screen's Save flow). Auto-print, overdue warnings and a daily report have no backing anywhere —
// no settings key, no automation layer (S5 never started, per /memory/state.md) — so they are
// rendered as unavailable with the reason rather than inert checkboxes that imply they almost work.
import { useEffect, useState } from "react";
import { Switch } from "@/components/menu/Fields";
import { ReadOnlySection } from "@/components/settings/SettingsSection";
import { useI18n } from "@/lib/i18n";
import { setSoundEnabled, soundEnabled } from "@/lib/sound";

export function NotificationsPanel() {
  const { t } = useI18n();
  const [sound, setSound] = useState(false);
  useEffect(() => setSound(soundEnabled()), []);

  return (
    <ReadOnlySection title={t("set.notifications")}>
      <Switch
        checked={sound}
        onChange={(v) => {
          setSound(v);
          setSoundEnabled(v);
        }}
        label={t("set.notifSound")}
        hint={t("set.notifSoundHint")}
      />
      <div className="flex flex-col gap-2 opacity-60">
        <Switch checked={false} onChange={() => {}} disabled label={t("set.notifAutoPrint")} />
        <Switch checked={false} onChange={() => {}} disabled label={t("set.notifOverdue")} />
        <Switch checked={false} onChange={() => {}} disabled label={t("set.notifDailyReport")} />
      </div>
      <span className="text-[11px] leading-[1.45] text-muted">{t("set.notifUnavailable")}</span>
    </ReadOnlySection>
  );
}
