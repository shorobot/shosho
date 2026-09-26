import { KitchenBoard } from "@/components/kitchen/KitchenBoard";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Küche" };

// Owner/operator may look at the kitchen screen too; the kitchen role lands here after login.
export default async function KitchenPage() {
  await requireRole(["kitchen", "owner", "operator"]);
  return <KitchenBoard />;
}
