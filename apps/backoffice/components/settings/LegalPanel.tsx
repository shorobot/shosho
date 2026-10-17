"use client";

// Legal: Impressum and USt-IdNr. live in settings.business, which BO · Website's BusinessPanel
// already edits — staged through `draft` and published with the rest of the site (§8.7). Opening a
// second, direct write path to the same key here would race the staged one and could publish an
// edit the owner never reviewed in context. So this panel reads the same key and says where to
// write it, rather than duplicating the form.
//
// Retention has no field anywhere in the schema — shown as unavailable rather than inventing one.
import Link from "next/link";
import { ReadOnlySection } from "@/components/settings/SettingsSection";
import { useI18n } from "@/lib/i18n";
import { useSettings } from "@/lib/settingsStore";

export function LegalPanel() {
  const { t } = useI18n();
  const { business } = useSettings();

  return (
    <ReadOnlySection title={t("set.legal")} hint={t("set.legalHint")}>
      <div className="flex flex-col gap-1.5">
        <span className="label-caps">{t("set.legalImpressum")}</span>
        <p className="whitespace-pre-wrap text-[12px] leading-[1.55] text-ink-2">{business.impressum || "—"}</p>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5 text-[12px]">
        <span className="label-caps">{t("set.legalUstId")}</span>
        <span className="font-extrabold">{business.ust_id || "—"}</span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-line pt-2.5 text-[12px]">
        <span className="label-caps">{t("set.legalRetention")}</span>
        <span className="text-muted">{t("set.legalRetentionUnavailable")}</span>
      </div>
      <Link href="/website" className="self-start text-[11px] font-extrabold text-blue hover:underline">
        {t("set.legalGoToWebsite")}
      </Link>
    </ReadOnlySection>
  );
}
