import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy-session";

/**
 * Next.js 16 Proxy (formerly "middleware"). Keeps the Supabase session fresh
 * and does optimistic redirects. See src/lib/supabase/proxy-session.ts.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static files, images, compiled audio worklets and
    // common asset extensions (they never need a session).
    "/((?!_next/static|_next/image|favicon.ico|worklets/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|wav)$).*)",
  ],
};
