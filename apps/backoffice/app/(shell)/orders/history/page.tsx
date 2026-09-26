import { History } from "@/components/history/History";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Historie" };

export default async function HistoryPage() {
  await requireRole(["owner", "operator"]);
  return <History />;
}
