"use client";

// The frame every `settings` panel shares: the draft badge, Save / Discard, and the one-line reason
// an operator's fields are read-only. Keeping it in one place means a new panel cannot forget to say
// that its edits are staged.
import type { ReactNode } from "react";
import { Section } from "@/components/menu/Fields";
import { Badge } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { useI18n } from "@/lib/i18n";
import type { SettingDraft } from "@/components/website/useSettingDraft";

export function SettingSection<T>({
  title, hint, draft, children, blocked,
}: {
  title: ReactNode;
  hint?: ReactNode;
  draft: SettingDraft<T>;
  children: ReactNode;
  /** A validation message: Save is disabled and the reason is shown next to it. */
  blocked?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Section
      title={
        <span className="flex flex-wrap items-center gap-2">
          {title}
          {draft.pending && <Badge tone="orange">{t("web.draftBadge")}</Badge>}
        </span>
      }
      hint={hint}
    >
      {children}
      {draft.canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Pill size="sm" onClick={() => void draft.save()} disabled={!draft.dirty || draft.busy || Boolean(blocked)}>
            {t("web.save")}
          </Pill>
          {blocked && <span className="text-[11px] font-extrabold leading-[1.45] text-alert">{blocked}</span>}
          {draft.pending && (
            <Pill variant="ghost" size="sm" onClick={() => void draft.discard()} disabled={draft.busy}>
              {t("web.discard")}
            </Pill>
          )}
          {draft.pending && <span className="text-[11px] leading-[1.45] text-orange-ink">{t("web.staged")}</span>}
        </div>
      ) : (
        <span className="text-[11px] leading-[1.45] text-muted">{t("web.settingsReadOnly")}</span>
      )}
    </Section>
  );
}
