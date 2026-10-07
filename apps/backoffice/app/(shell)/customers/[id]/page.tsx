import { Profile } from "@/components/crm/Profile";
import { CrmProvider } from "@/lib/crmStore";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Profil" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { staff } = await requireRole(["owner", "operator"]);
  const { id } = await params;
  return (
    <CrmProvider me={staff}>
      <Profile customerId={id} />
    </CrmProvider>
  );
}
