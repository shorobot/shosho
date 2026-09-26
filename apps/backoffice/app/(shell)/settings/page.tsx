import { ComingSoon } from "@/components/shell/ComingSoon";
import { requireRole } from "@/lib/auth";

export default async function Page() {
  await requireRole(["owner", "operator"]);
  return <ComingSoon section="nav.settings" />;
}
