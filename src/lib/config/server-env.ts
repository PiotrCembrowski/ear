import "server-only";
import { z } from "zod";
import { HISTORY_RATE_LIMIT_DEFAULTS } from "./app-config";

/**
 * Server-only environment variables. Importing this file from a Client
 * Component fails the build (that is what `server-only` is for), so the secret
 * key can never be bundled into browser JavaScript.
 */
const serverEnvSchema = z.object({
  /** Supabase "secret" key (sb_secret_…) or the legacy service_role key. Bypasses RLS: server use only. */
  SUPABASE_SECRET_KEY: z.string().min(20, "SUPABASE_SECRET_KEY is missing"),
  HISTORY_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(10_000).default(HISTORY_RATE_LIMIT_DEFAULTS.max),
  HISTORY_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(86_400)
    .default(HISTORY_RATE_LIMIT_DEFAULTS.windowSeconds),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    HISTORY_RATE_LIMIT_MAX: process.env.HISTORY_RATE_LIMIT_MAX || undefined,
    HISTORY_RATE_LIMIT_WINDOW_SECONDS: process.env.HISTORY_RATE_LIMIT_WINDOW_SECONDS || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Invalid server environment configuration:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}
