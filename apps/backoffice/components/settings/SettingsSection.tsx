"use client";

// The frame every writable Einstellungen panel shares: a Save button when there is something to
// save, and the one-line reason an operator sees the fields read-only — the Einstellungen half of
// S4-04-settings-cms.md's lesson, without BO · Website's draft/publish badge (these keys are not
// staged; a save here takes effect on the next order immediately).
import type { ReactNode } from "react";
import { Section } from "@/components/menu/Fields";
import { Pill } from "@/components/ui/Pill";
import { useI18n } from "@/lib/i18n";

export function SettingsSection({
  title, hint, canEdit, dirty, busy, onSave, children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  canEdit: boolean;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Section title={title} hint={hint}>
      {children}
      {canEdit ? (
        <div className="flex items-center gap-2">
          <Pill size="sm" onClick={onSave} disabled={!dirty || busy}>
            {t("set.save")}
          </Pill>
        </div>
      ) : (
        <span className="text-[11px] leading-[1.45] text-muted">{t("set.readOnlyBanner")}</span>
      )}
    </Section>
  );
}

/** A panel with no write path at all (read-only views, unavailable features) — no Save button, ever. */
export function ReadOnlySection({ title, hint, children }: { title: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return <Section title={title} hint={hint}>{children}</Section>;
}
