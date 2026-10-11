import { WebsiteScreen } from "@/components/website/WebsiteScreen";
import { SiteProvider } from "@/lib/siteStore";
import { requireRole } from "@/lib/auth";

// BO · Website (CMS). The gate is the route's own, not just RLS: a kitchen or driver session is
// redirected to its home before any query runs. RLS is the backstop — S4-03 found that a write a
// policy does not admit comes back `[]` with no error, so the route guard is what actually holds.
export default async function Page() {
  const { staff } = await requireRole(["owner", "operator"]);
  return (
    <SiteProvider me={staff}>
      <WebsiteScreen />
    </SiteProvider>
  );
}
