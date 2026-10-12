import { ReportsScreen } from "@/components/reports/ReportsScreen";
import { ReportsProvider } from "@/lib/reportsStore";
import { requireRole } from "@/lib/auth";

// BO · Berichte. Kitchen/driver never reach this route — the guard is the route's own, not just
// RLS: S4-03 found a write a policy does not admit comes back `[]` with no error, and §8.5's own
// `report_payments` guard is narrower than the other four reports (owner/operator only), so this
// route stays owner/operator to avoid a screen that is half-usable for a role it should not show
// payment data to at all.
export default async function Page() {
  const { staff } = await requireRole(["owner", "operator"]);
  return (
    <ReportsProvider me={staff}>
      <ReportsScreen />
    </ReportsProvider>
  );
}
