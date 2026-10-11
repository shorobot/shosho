import { MarketingScreen } from "@/components/marketing/MarketingScreen";

// The gate and the store live in this segment's layout, so every /marketing* route shares them.
export default function Page() {
  return <MarketingScreen />;
}
