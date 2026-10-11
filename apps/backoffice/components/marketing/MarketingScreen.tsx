"use client";

// BO · Marketing (api-contracts §8.1–§8.4, §1.5). Layout follows the canvas: KPI row, then promo
// codes and campaigns in the main column, automations and the discount chart beside them.
import { PillLink } from "@/components/ui/Pill";
import { ErrorState, Spinner } from "@/components/ui/States";
import { Automations } from "@/components/marketing/Automations";
import { CampaignList } from "@/components/marketing/CampaignList";
import { DiscountChart } from "@/components/marketing/DiscountChart";
import { Kpis } from "@/components/marketing/Kpis";
import { PromoCodes } from "@/components/marketing/PromoCodes";
import { useI18n } from "@/lib/i18n";
import { promoState } from "@/lib/marketing";
import { useMarketing } from "@/lib/marketingStore";

export function MarketingScreen() {
  const { t } = useI18n();
  const { campaigns, promos, canWrite, loading, error, now } = useMarketing();
  const activeCodes = promos.filter((p) => promoState(p, now) === "live").length;

  return (
    <div className="screen-in flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[24px] font-extrabold leading-[1.2]">{t("mkt.title")}</h1>
        <span className="text-[12px] text-muted">{t("mkt.sub", { c: campaigns.length, p: activeCodes })}</span>
        <div className="ml-auto flex items-center gap-2">
          {loading && <Spinner />}
          {canWrite && (
            <PillLink size="sm" href="/marketing/campaign/new">
              {t("mkt.newCampaign")}
            </PillLink>
          )}
        </div>
      </div>

      {error && <ErrorState title={t("mkt.saveError", { e: error })} body={t("mkt.denied")} />}

      <Kpis />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <PromoCodes />
          <CampaignList />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Automations />
          <DiscountChart />
        </div>
      </div>
    </div>
  );
}
