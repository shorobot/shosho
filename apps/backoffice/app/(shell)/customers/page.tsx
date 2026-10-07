import { CustomersScreen } from "@/components/crm/CustomersScreen";
import { CrmProvider } from "@/lib/crmStore";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Kunden" };

export default async function Page() {
  // operator/owner only. Kitchen and driver are redirected to their own screens by requireRole, and
  // RLS refuses them `customers` outright even if they got here (/docs/security.md §2).
  const { staff } = await requireRole(["owner", "operator"]);
  return (
    <CrmProvider me={staff}>
      <CustomersScreen />
    </CrmProvider>
  );
}
