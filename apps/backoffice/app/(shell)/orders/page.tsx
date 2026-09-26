import { Board } from "@/components/orders/Board";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Bestellungen" };

export default async function OrdersPage() {
  await requireRole(["owner", "operator"]);
  return <Board />;
}
