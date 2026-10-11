"use client";

// Publication history from `site_publications` (§8.7) — written only by `publish_site()`, staff
// read-only. Each row carries `summary` (what was touched) and `snapshot` ({from, to} per key,
// captured before the update ran), so the history answers "what did that publish actually change"
// rather than just "something was published".
import { useState } from "react";
import { Section } from "@/components/menu/Fields";
import { EmptyState } from "@/components/ui/States";
import { fullDateTime } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import { publicationSize, publicationSummary, type PublicationRow } from "@/lib/site";
import { useSite } from "@/lib/siteStore";

export function PublishHistory() {
  const { t, lang } = useI18n();
  const { publications, staff } = useSite();
  const [open, setOpen] = useState<string | null>(null);

  const actorName = (id: string | null) => staff.find((s) => s.id === id)?.name ?? t("web.historyActorUnknown");

  if (publications.length === 0) {
    return (
      <Section title={t("web.history")}>
        <EmptyState icon="◷" title={t("web.historyEmptyTitle")} body={t("web.historyEmptyBody")} />
      </Section>
    );
  }

  return (
    <Section title={t("web.history")}>
      <div className="flex flex-col gap-1.5">
        {publications.map((p) => {
          const n = publicationSize(p);
          const { settingsKeys, bannerIds } = publicationSummary(p);
          const expanded = open === p.id;
          return (
            <div key={p.id} className="rounded-[12px] bg-field-2 px-3 py-2.5">
              <button type="button" onClick={() => setOpen(expanded ? null : p.id)} className="flex w-full flex-wrap items-center gap-2 text-left" aria-expanded={expanded}>
                <span className="text-[12px] font-extrabold">{fullDateTime(p.at, lang)}</span>
                <span className="text-[11px] text-ink-3">{n === 1 ? t("web.historyRowOne", { a: actorName(p.actor_id) }) : t("web.historyRow", { n, a: actorName(p.actor_id) })}</span>
                <span className="ml-auto text-[11px] text-muted">{expanded ? "−" : "+"}</span>
              </button>
              {expanded && (
                <div className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
                  {settingsKeys.length > 0 && <span className="text-[11px] text-ink-3">{t("web.historySettings", { k: settingsKeys.join(", ") })}</span>}
                  {bannerIds.length > 0 && <span className="text-[11px] text-ink-3">{t("web.historyBanners", { n: bannerIds.length })}</span>}
                  <Snapshot row={p} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/**
 * The `{from, to}` pairs the publish recorded. Rendered as JSON on purpose: it is an audit record,
 * and a prettier per-key diff would need a renderer per settings shape that could quietly disagree
 * with what was stored. The raw pair cannot be wrong about itself.
 */
function Snapshot({ row }: { row: PublicationRow }) {
  const text = JSON.stringify(row.snapshot, null, 2);
  if (text === "{}" || text === "null") return null;
  return (
    <pre className="max-h-[220px] overflow-auto rounded-[10px] bg-paper p-2.5 text-[10px] leading-[1.5] text-ink-3">{text}</pre>
  );
}
