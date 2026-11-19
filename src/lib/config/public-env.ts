import { z } from "zod";

/**
 * Environment variables that are safe to expose to the browser.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time only when each
 * variable is referenced literally, so we list them one by one below instead of
 * passing `process.env` around.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a URL" }),
  /** Supabase "publishable" key (sb_publishable_…) or the legacy anon key. Safe in the browser; RLS protects data. */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing"),
  /** Public URL of this app, used for auth email redirect links. */
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | undefined;

/**
 * Parses the public env lazily, so that `next build` and unit tests do not
 * crash on modules that merely import this file. The first real use throws a
 * readable error if something is missing.
 */
export function getPublicEnv(): PublicEnv {
  if (cached) return cached;
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Invalid public environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}
