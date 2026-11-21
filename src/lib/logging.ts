/**
 * Minimal server-side error logging. Users only ever see friendly messages;
 * details (stack traces, Supabase error codes) go to the server log, which on
 * Vercel is the function log.
 */
export function logServerError(context: string, error: unknown, details?: Record<string, unknown>): void {
  const base =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : typeof error === "object" && error !== null
        ? error
        : { value: String(error) };
  console.error(`[soundmatch] ${context}`, { ...base, ...details });
}
