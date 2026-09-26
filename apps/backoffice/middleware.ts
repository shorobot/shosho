import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // everything except static assets
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|sounds/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|wav)$).*)"],
};
