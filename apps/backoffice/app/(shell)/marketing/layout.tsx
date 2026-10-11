import { requireRole } from "@/lib/auth";
import { MarketingProvider } from "@/lib/marketingStore";

// Every /marketing* screen is behind the same gate and shares one load of promo codes, campaigns,
// automations and the order slice the KPIs read. Kitchen and driver are redirected to their own
// home before any query runs (§6.9); RLS is the backstop, not the gate — a write a policy does not
// admit comes back `[]` with no error (S4-03), so the route check is what actually holds.
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await requireRole(["owner", "operator"]);
  return <MarketingProvider me={staff}>{children}</MarketingProvider>;
}
