"use client";

// Banners panel of BO · Website (api-contracts §8.6).
//
// Two tables, deliberately: the full `banners` list with each row's state, and next to it exactly
// what `banners_live` returns right now. The second one is the honest answer to "why isn't my banner
// showing" — the view is `active and in-window`, so a row present above and absent below has its
// reason in its own badge rather than in a support conversation.
import { useState } from "react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { BannerEditor } from "@/components/website/BannerEditor";
import { BannerThumb } from "@/components/website/BannerThumb";
import { Section } from "@/components/menu/Fields";
import { shortDate } from "@/lib/datetime";
import { useI18n, type Key } from "@/lib/i18n";
import { bannerState, hasPendingDraft, liveBanners, mergeBannerDraft, type BannerRow, type BannerState } from "@/lib/site";
import { useSite } from "@/lib/siteStore";

const TONES: Record<BannerState, Tone> = { live: "ok", scheduled: "blue", expired: "muted", inactive: "muted" };

export function BannerList() {
  const { t, lang } = useI18n();
  const { banners, canEditContent, now } = useSite();
  const [editing, setEditing] = useState<BannerRow | "new" | null>(null);

  const live = liveBanners(banners, now);
  const counts = banners.reduce(
    (acc, b) => {
      const s = bannerState(mergeBannerDraft(b), now);
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    },
    {} as Record<BannerState, number>,
  );

  return (
    <>
      <Section
        title={t("web.banners")}
        hint={t("web.bannersCount", { n: counts.live ?? 0, s: counts.scheduled ?? 0, e: counts.expired ?? 0 })}
      >
        {banners.length === 0 ? (
          <EmptyState
            icon="▭"
            title={t("web.bannersEmptyTitle")}
            body={t("web.bannersEmptyBody")}
            action={canEditContent ? <Pill size="sm" onClick={() => setEditing("new")}>{t("web.addBanner")}</Pill> : undefined}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {banners.map((b) => {
              // The row shows the EFFECTIVE banner (live columns + pending patch), because that is
              // what the operator is editing — with the state computed from the same merged values,
              // so a staged "active" shows as what it will become, badged as a draft.
              const eff = mergeBannerDraft(b);
              const state = bannerState(eff, now);
              const why =
                state === "scheduled" ? t("web.why.scheduled", { d: shortDate(eff.valid_from, lang) })
                : state === "expired" ? t("web.why.expired", { d: shortDate(eff.valid_to, lang) })
                : state === "inactive" ? t("web.why.inactive")
                : t("web.why.live");
              return (
                <div key={b.id} className="flex items-center gap-3 rounded-[14px] bg-field-2 p-2.5">
                  <BannerThumb path={eff.image_path} size={46} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-extrabold leading-[1.3]">
                      {eff.title_de || eff.title_en || "—"}
                      {hasPendingDraft(b) && <Badge tone="orange">{t("web.draftBadge")}</Badge>}
                    </span>
                    <span className="truncate text-[11px] text-muted">
                      {t(`web.slot.${eff.slot}` as Key)} · {why}
                    </span>
                  </div>
                  <Badge tone={TONES[state]}>{t(`web.state.${state}` as Key)}</Badge>
                  <Pill variant="ghost" size="xs" onClick={() => setEditing(b)}>
                    {canEditContent ? t("mkt.edit") : t("web.previewLive")}
                  </Pill>
                </div>
              );
            })}
            {canEditContent && (
              <button
                type="button"
                onClick={() => setEditing("new")}
                className="rounded-[14px] border border-dashed border-line-3 bg-field-2 py-2.5 text-[12px] font-extrabold text-orange transition-micro hover:border-orange-line"
              >
                {t("web.addBanner")}
              </button>
            )}
            <span className="text-[11px] leading-[1.45] text-muted">{t("web.bannerHint")}</span>
          </div>
        )}
      </Section>

      <Section title={t("web.liveNow")} hint={t("web.liveNowHint")}>
        {live.length === 0 ? (
          <span className="text-[12px] text-muted">{t("web.liveNowEmpty")}</span>
        ) : (
          <div className="flex flex-col gap-1.5">
            {live.map((b) => (
              <div key={b.id} className="flex items-center gap-2.5 rounded-[12px] bg-ok-tint px-2.5 py-2">
                <BannerThumb path={b.image_path} size={34} />
                <span className="min-w-0 flex-1 truncate text-[12px] font-extrabold">{b.title_de || b.title_en || "—"}</span>
                <span className="text-[11px] text-ink-3">{t(`web.slot.${b.slot}` as Key)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {editing && <BannerEditor row={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
