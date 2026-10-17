"use client";

// "Danger zone" per S4-05-reports.md's done-when list. Per-customer deletion/export already exists
// (BO · Kunden → Profil, components/crm/GdprControls.tsx — export is real, deletion files an
// auditable request rather than performing one, since no single-customer erasure RPC exists yet,
// S2-single-customer-erasure.md). There is no project-wide reset/wipe anywhere in the schema, and
// none is invented here — this panel points at what exists instead of adding a new destructive
// control nobody asked for.
import Link from "next/link";
import { ReadOnlySection } from "@/components/settings/SettingsSection";
import { useI18n } from "@/lib/i18n";

export function DangerZonePanel() {
  const { t } = useI18n();
  return (
    <ReadOnlySection title={t("set.danger")}>
      <p className="text-[12px] leading-[1.55] text-muted">{t("set.dangerHint")}</p>
      <Link href="/customers" className="self-start text-[11px] font-extrabold text-blue hover:underline">
        {t("nav.customers")} →
      </Link>
    </ReadOnlySection>
  );
}
