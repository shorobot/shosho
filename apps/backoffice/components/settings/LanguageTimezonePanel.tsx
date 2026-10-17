"use client";

// Language is per-device (the toggle in the shell header, lib/i18n.tsx's localStorage choice) —
// shown here as a pointer, not a second control that could disagree with the real one. Timezone is
// not a setting at all: Europe/Berlin is hard-wired across the system (lib/time.ts's `TZ` constant,
// every report's day boundary, every promised-time calculation) — a dropdown here would imply an
// app-wide change that nothing downstream could honour.
import { ReadOnlySection } from "@/components/settings/SettingsSection";
import { useI18n } from "@/lib/i18n";

export function LanguageTimezonePanel() {
  const { t, lang } = useI18n();
  return (
    <ReadOnlySection title={t("set.language")} hint={t("set.languageHint")}>
      <div className="flex items-center justify-between gap-3 text-[12px]">
        <span className="label-caps">{t("set.language")}</span>
        <span className="font-extrabold">{lang === "de" ? "Deutsch" : "English"}</span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5 text-[12px]">
        <span className="label-caps">{t("set.timezone")}</span>
        <span className="font-extrabold">{t("set.timezoneValue")}</span>
      </div>
      <span className="text-[11px] leading-[1.45] text-muted">{t("set.timezoneHint")}</span>
    </ReadOnlySection>
  );
}
