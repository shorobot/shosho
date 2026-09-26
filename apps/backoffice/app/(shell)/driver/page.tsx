import { DriverBoard } from "@/components/driver/DriverBoard";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Fahrer" };

export default async function DriverPage() {
  const { staff } = await requireRole(["driver", "owner", "operator"]);
  return <DriverBoard me={staff} />;
}
