import { redirect } from "next/navigation";
import { Shell } from "@/components/shell/Shell";
import { getSession } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/env";
import { OrdersProvider } from "@/lib/store";

// Every screen behind the sign-in shares the nav rail and one realtime orders store.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  if (!isSupabaseConfigured()) redirect("/login");
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.staff) redirect("/no-access");
  return (
    <OrdersProvider me={session.staff}>
      <Shell me={session.staff}>{children}</Shell>
    </OrdersProvider>
  );
}
