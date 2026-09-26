import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Staff, StaffRole } from "@/lib/types";

export type Session = { userId: string; email: string; staff: Staff | null };

/** Who is signed in (validated against Auth) and their `staff` row (own row is readable by every role). */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: staff } = await supabase.from("staff").select("id, name, role, active").eq("id", user.id).maybeSingle();
  return { userId: user.id, email: user.email ?? "", staff: staff && staff.active ? staff : null };
}

export function homeFor(role: StaffRole): string {
  switch (role) {
    case "kitchen":
      return "/kitchen";
    case "driver":
      return "/driver";
    default:
      return "/orders";
  }
}

/** Server-side gate for a page: signed-in staff with one of `roles`, else redirect to their own home. */
export async function requireRole(roles: StaffRole[]): Promise<{ session: Session; staff: Staff }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.staff) redirect("/no-access");
  if (!roles.includes(session.staff.role)) redirect(homeFor(session.staff.role));
  return { session, staff: session.staff };
}
