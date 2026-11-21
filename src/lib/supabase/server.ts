import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/config/public-env";
import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * acting AS THE SIGNED-IN USER (publishable key + session cookie), so Row
 * Level Security applies. Create one per request; never share it between
 * requests.
 */
export async function createServerSupabase(): Promise<SupabaseClient<Database>> {
  // cookies() first: it marks the page as dynamic (rendered per request), so
  // Next.js never tries to pre-render it at build time, when env vars may be absent.
  const cookieStore = await cookies(); // async since Next.js 15; sync access removed in 16
  const env = getPublicEnv();

  return createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. That is fine: proxy.ts
          // refreshes the session cookie on every request before rendering.
        }
      },
    },
  });
}
