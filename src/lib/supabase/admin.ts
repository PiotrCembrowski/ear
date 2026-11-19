import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/config/public-env";
import { getServerEnv } from "@/lib/config/server-env";
import type { Database } from "./database.types";

/**
 * Supabase client with the SECRET key. It BYPASSES Row Level Security.
 *
 * Use it only in server code, and only after you have checked who the user is
 * and what they may do. Current uses:
 *   - inserting history rows (POST /api/comparisons) with user_id from the session
 *   - deleting a user's account
 *
 * `server-only` makes the build fail if a Client Component imports this file.
 */
export function createAdminSupabase(): SupabaseClient<Database> {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const { SUPABASE_SECRET_KEY } = getServerEnv();
  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
