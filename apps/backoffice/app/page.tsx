import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/lib/auth";

// Entry: route by role (owner/operator → /orders, kitchen → /kitchen, driver → /driver).
export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.staff) redirect("/no-access");
  redirect(homeFor(session.staff.role));
}
