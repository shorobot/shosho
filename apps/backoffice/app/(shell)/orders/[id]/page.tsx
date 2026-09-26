import { OrderDetail } from "@/components/detail/OrderDetail";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Bestellung" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(["owner", "operator"]);
  const { id } = await params;
  return <OrderDetail id={id} />;
}
