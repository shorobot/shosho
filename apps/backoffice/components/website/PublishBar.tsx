"use client";

// The header and the unpublished-changes counter of BO · Website (api-contracts §8.7).
//
// The counter is `pendingChanges()` — rows with a non-null `draft` — which is the exact predicate
// `publish_site()` uses to decide what to copy. They cannot disagree, because neither is an
// estimate. The sentence under it is the only place a non-technical owner learns that edits are
// staged at all, which is why it is UI copy and not a tooltip.
import { useState } from "react";
import { Pill } from "@/components/ui/Pill";
import { Spinner } from "@/components/ui/States";
import { useEnv } from "@/components/providers/EnvProvider";
import { fullDateTime } from "@/lib/datetime";
import { useI18n, type Key } from "@/lib/i18n";
import { publishResultSize, type PendingChange } from "@/lib/site";
import { useSite } from "@/lib/siteStore";
import { toast } from "@/lib/toast";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** "Banner „Lunch“, Einstellungen: site, opening_hours" — the counter's "named, not just counted". */
function describe(pending: PendingChange[], t: (k: Key, v?: Record<string, string | number>) => string): string {
  const settings = pending.filter((p) => p.kind === "setting").map((p) => (p as { key: string }).key);
  const banners = pending.filter((p) => p.kind === "banner").map((p) => (p as { name: string | null }).name).filter((n): n is string => Boolean(n));
  const parts: string[] = [];
  if (settings.length) parts.push(t("web.historySettings", { k: settings.join(", ") }));
  if (banners.length) parts.push(t("web.historyBanners", { n: banners.join(", ") }));
  // A banner with no title yet still counts; name the count rather than leaving the list short.
  const unnamed = pending.filter((p) => p.kind === "banner").length - banners.length;
  if (unnamed > 0) parts.push(t("web.historyBanners", { n: unnamed }));
  return parts.join(" · ");
}

export function PublishBar() {
  const { t, lang } = useI18n();
  const env = useEnv();
  const { pending, publications, canPublish, publish, loading } = useSite();
  const [busy, setBusy] = useState(false);

  const last = publications[0];
  const count = pending.length;

  async function onPublish() {
    setBusy(true);
    const res = await publish(lang);
    setBusy(false);
    if (res == null) return;
    const moved = publishResultSize(res);
    toast(moved > 0 ? t("web.published", { n: moved }) : t("web.publishedNothing"), "ok");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] font-extrabold leading-[1.2]">{t("web.title")}</h1>
        <span className="text-[12px] text-muted">
          {last
            ? t("web.lastPublished", { h: hostOf(env.siteUrl), d: fullDateTime(last.at, lang) })
            : t("web.neverPublished", { h: hostOf(env.siteUrl) })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {loading && <Spinner />}
          <a href={env.siteUrl} target="_blank" rel="noreferrer" className="rounded-full bg-paper px-3.5 py-2 text-[12px] font-medium text-ink-2 shadow-(--shadow-pill) hover:text-ink">
            {t("web.openSite")}
          </a>
          <Pill size="sm" onClick={onPublish} disabled={!canPublish || count === 0 || busy} title={canPublish ? undefined : t("web.publishOwnerOnly")}>
            {busy ? t("web.publishing") : t("web.publish")}
          </Pill>
        </div>
      </div>

      <div className={`card flex flex-col gap-2 rounded-[18px] border-l-[5px] p-4 ${count > 0 ? "border-orange-ink" : "border-ok"}`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full text-[12px] font-extrabold text-white ${count > 0 ? "bg-orange" : "bg-ok"}`}>
            {count > 0 ? count : "✓"}
          </span>
          <span className="text-[14px] font-extrabold leading-[1.35]">
            {count === 0 ? t("web.pendingNone") : count === 1 ? t("web.pendingOne") : t("web.pending", { n: count })}
          </span>
          {count > 0 && <span className="text-[12px] text-ink-3">{describe(pending, t)}</span>}
        </div>
        <span className="text-[12px] leading-[1.55] text-ink-3">{count === 0 ? t("web.nothingPending") : t("web.whatPublishDoes")}</span>
        {count > 0 && !canPublish && <span className="text-[11px] font-extrabold leading-[1.45] text-orange-ink">{t("web.publishOwnerOnly")}</span>}
      </div>
    </div>
  );
}
