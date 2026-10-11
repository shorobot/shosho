import { CampaignGate } from "@/components/marketing/CampaignGate";

// `/marketing/campaign/new` and `/marketing/campaign/<uuid>` are the same wizard; which campaign it
// edits is resolved client-side from the store the segment layout already loaded, so opening the
// wizard costs no extra round trip.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignGate id={id} />;
}
