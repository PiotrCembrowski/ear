import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideProxyAction } from "@/lib/auth/routes";
import { getPublicEnv } from "@/lib/config/public-env";
import type { Database } from "./database.types";

/**
 * Runs on every matched request (from src/proxy.ts):
 *
 * 1. Refreshes the Supabase session if the access token expired, writing the
 *    new cookies onto BOTH the request (so Server Components rendering this
 *    request see them) and the response (so the browser stores them).
 * 2. Makes a quick, cookie-based redirect decision (see decideProxyAction).
 *
 * This is an optimistic check only. Pages and route handlers verify the user
 * again with requireUser(), and the database enforces Row Level Security.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Headers like Cache-Control: no-store, so a CDN never caches a response carrying someone's session.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // IMPORTANT: nothing may run between creating the client and getClaims(),
  // otherwise a refresh could be missed and users randomly signed out.
  // getClaims() verifies the JWT (locally with asymmetric signing keys) and
  // refreshes an expired session.
  let isSignedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    isSignedIn = Boolean(data?.claims?.sub);
  } catch (error) {
    // Auth server unreachable: treat as signed out for redirects; pages will
    // show a friendly error if they need the user.
    console.error("[proxy] session check failed", error);
  }

  const decision = decideProxyAction(request.nextUrl.pathname, request.nextUrl.search, isSignedIn);
  if (decision.type === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // Carry over any refreshed/cleared session cookies.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}
