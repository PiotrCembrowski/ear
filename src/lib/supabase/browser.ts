"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/config/public-env";
import type { Database } from "./database.types";

let browserClient: SupabaseClient<Database> | undefined;

/**
 * Supabase client for Client Components. Uses the publishable key and the
 * user's session cookie, so Row Level Security applies to every query.
 * One instance per browser tab is enough, so it is created once and reused.
 *
 * App code should not call this directly for data access: go through
 * `src/lib/services/*` (coding rule 3). Auth UI is the exception.
 */
export function getBrowserSupabase(): SupabaseClient<Database> {
  if (!browserClient) {
    const env = getPublicEnv();
    browserClient = createBrowserClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  }
  return browserClient;
}
