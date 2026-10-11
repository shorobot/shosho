"use client";

// Resolves `/marketing/campaign/<id>` against the campaigns the segment layout already loaded.
// A `new` id is a blank wizard; an id that matches nothing says so instead of rendering an empty
// form that would silently create a second campaign on save.
import { EmptyState, Spinner } from "@/components/ui/States";
import { PillLink } from "@/components/ui/Pill";
import { CampaignWizard } from "@/components/marketing/CampaignWizard";
import { useI18n } from "@/lib/i18n";
import { useMarketing } from "@/lib/marketingStore";

export function CampaignGate({ id }: { id: string }) {
  const { t } = useI18n();
  const { campaigns, loading } = useMarketing();

  if (id === "new") return <CampaignWizard campaign={null} />;
  if (loading) return <Spinner label={t("mkt.reachLoading")} />;

  const campaign = campaigns.find((c) => c.id === id);
  if (!campaign) {
    return (
      <EmptyState
        icon="✉"
        title={t("mkt.campaignsEmptyTitle")}
        body={t("mkt.campaignsEmptyBody")}
        action={<PillLink size="sm" href="/marketing">{t("mkt.wizBack")}</PillLink>}
      />
    );
  }
  return <CampaignWizard campaign={campaign} />;
}
