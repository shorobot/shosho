"use client";

// BO · Website — the CMS screen (api-contracts §8.6 / §8.7).
//
// Layout follows the canvas: the publish bar and the unpublished-changes counter at the top, the
// editing panels in the left column, and the live/preview column on the right. Everything the
// panels save goes into a `draft`; `publish_site()` is the only thing that moves it to the live
// value, and only the owner can call it.
import { ErrorState, Spinner } from "@/components/ui/States";
import { BannerList } from "@/components/website/BannerList";
import { BusinessPanel } from "@/components/website/BusinessPanel";
import { HoursPanel } from "@/components/website/HoursPanel";
import { PublishBar } from "@/components/website/PublishBar";
import { PublishHistory } from "@/components/website/PublishHistory";
import { SeoPanel } from "@/components/website/SeoPanel";
import { ZonesPanel } from "@/components/website/ZonesPanel";
import { useI18n } from "@/lib/i18n";
import { useSite } from "@/lib/siteStore";

export function WebsiteScreen() {
  const { t } = useI18n();
  const { loading, error, canEditSettings } = useSite();

  return (
    <div className="screen-in flex flex-col gap-4">
      <PublishBar />
      {error && <ErrorState title={t("web.saveError", { e: error })} body={t("web.denied")} />}
      {loading && <Spinner label={t("mkt.reachLoading")} />}
      {!canEditSettings && <span className="text-[12px] leading-[1.55] text-muted">{t("web.settingsReadOnly")}</span>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <BannerList />
          <BusinessPanel />
          <HoursPanel />
          <ZonesPanel />
          <SeoPanel />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <PublishHistory />
        </div>
      </div>
    </div>
  );
}
