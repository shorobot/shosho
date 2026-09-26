import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/lib/auth";
import { NoAccess } from "@/components/shell/NoAccess";

export const metadata = { title: "Kein Zugriff" };

export default async function NoAccessPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.staff) redirect(homeFor(session.staff.role));
  return <NoAccess email={session.email} />;
}
