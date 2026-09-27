import { requireRole } from "@/lib/auth";
import { MenuProvider } from "@/lib/menuStore";

// Every /menu* screen is behind the same gate (§6.5: operator/owner write, kitchen may read the
// catalogue) and shares one load of categories, items, option groups and their links.
export default async function MenuLayout({ children }: { children: React.ReactNode }) {
  const { staff } = await requireRole(["owner", "operator"]);
  return <MenuProvider me={staff}>{children}</MenuProvider>;
}
