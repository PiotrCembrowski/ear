import "server-only";

import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Supabase Auth calls, run on the server with the request's cookies so the
 * session cookie is set/cleared on the response. Results are plain objects:
 * callers turn `errorCode` into a friendly message (features/auth/auth-errors.ts).
 */

export type AuthResult = { ok: true } | { ok: false; errorCode: string; status?: number; detail: string };

function failure(error: { code?: string; status?: number; message: string }): AuthResult {
  return { ok: false, errorCode: error.code ?? "unknown", status: error.status, detail: error.message };
}

export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? failure(error) : { ok: true };
}

export type SignUpResult =
  | { ok: true; outcome: "signed_in" | "confirmation_sent" }
  | Extract<AuthResult, { ok: false }>;

/**
 * Creates an account. With "Confirm email" enabled in Supabase (recommended),
 * no session is returned and the user must click the emailed link.
 *
 * For an email that is already registered, Supabase deliberately returns a
 * normal-looking response (to prevent account enumeration); we show the same
 * "check your email" message in both cases.
 */
export async function signUp(input: {
  email: string;
  password: string;
  displayName: string | null;
  emailRedirectTo: string;
}): Promise<SignUpResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: input.emailRedirectTo,
      // Read by the on_auth_user_created trigger to fill profiles.display_name.
      data: input.displayName ? { display_name: input.displayName } : {},
    },
  });
  if (error) {
    const result = failure(error);
    return result as Extract<AuthResult, { ok: false }>;
  }
  return { ok: true, outcome: data.session ? "signed_in" : "confirmation_sent" };
}

export async function signOut(): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  // scope "local": sign out this browser only, not the user's other devices.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  return error ? failure(error) : { ok: true };
}

export async function requestPasswordReset(email: string, redirectTo: string): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return error ? failure(error) : { ok: true };
}

/** Sets a new password for the signed-in user (e.g. after a recovery link). */
export async function updatePassword(password: string): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  return error ? failure(error) : { ok: true };
}

/**
 * Verifies an emailed link and starts a session. Two link styles exist:
 *  - token_hash + type (recommended email templates; works in any browser)
 *  - code (PKCE; only works in the browser that started the flow)
 */
export async function verifyEmailLink(
  params: { tokenHash: string; type: EmailOtpType } | { code: string },
): Promise<AuthResult> {
  const supabase = await createServerSupabase();
  const { error } =
    "code" in params
      ? await supabase.auth.exchangeCodeForSession(params.code)
      : await supabase.auth.verifyOtp({ token_hash: params.tokenHash, type: params.type });
  return error ? failure(error) : { ok: true };
}
