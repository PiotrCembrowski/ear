import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { logServerError } from "@/lib/logging";
import { createServerSupabase } from "@/lib/supabase/server";
import { getOwnProfile, type Profile } from "@/lib/services/profiles";
import { DEFAULT_SIGNED_IN_PATH, signInPathWithNext } from "./routes";

export type SessionUser = {
  id: string;
  email: string | null;
};

/**
 * The verified user for THIS request, or null when signed out.
 *
 * Uses getClaims(), which verifies the session JWT's signature (locally when
 * the project uses asymmetric signing keys, otherwise via the Auth server).
 * Never trust getSession() on the server: it only reads the cookie.
 *
 * Wrapped in React `cache` so several components can call it during one
 * render without repeating the work.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    // An expired/invalid session is normal (user is signed out). Anything else is logged.
    if (error.name !== "AuthSessionMissingError") logServerError("getSessionUser", error);
    return null;
  }
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

/**
 * Use at the top of every protected page, Server Action and Route Handler.
 * Redirects signed-out users to sign-in, remembering `returnTo`.
 */
export async function requireUser(returnTo: string = DEFAULT_SIGNED_IN_PATH): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(signInPathWithNext(returnTo));
  return user;
}

/** The signed-in user's profile (cached per request). Throws if it cannot be loaded. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  return getOwnProfile(user.id);
});

/**
 * For admin pages and actions. Signed-out users go to sign-in; signed-in
 * non-admins get a 404-style redirect to the dashboard (we don't advertise
 * that admin pages exist). The database ALSO enforces admin rights via RLS.
 */
export async function requireAdmin(returnTo: string): Promise<{ user: SessionUser; profile: Profile }> {
  const user = await requireUser(returnTo);
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") redirect(DEFAULT_SIGNED_IN_PATH);
  return { user, profile };
}
