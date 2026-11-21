import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { ROUTES, safeRedirectPath } from "@/lib/auth/routes";
import { logServerError } from "@/lib/logging";
import { verifyEmailLink } from "@/lib/services/auth";
import { emailOtpTypeSchema } from "@/lib/validation/auth";

/**
 * Landing point for links in Supabase emails (sign-up confirmation, password
 * reset). Verifying the link signs the user in: the session cookies are set
 * through next/headers during verifyEmailLink(), and `redirect()` sends them
 * along with the redirect response.
 *
 * Supports both link styles: `token_hash` + `type` (recommended email
 * templates, see README) and `code` (Supabase's default PKCE links).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = emailOtpTypeSchema.safeParse(searchParams.get("type"));
  const next = safeRedirectPath(searchParams.get("next"));
  const isPasswordReset = (type.success && type.data === "recovery") || next === ROUTES.updatePassword;

  const result =
    tokenHash && type.success
      ? await verifyEmailLink({ tokenHash, type: type.data })
      : code
        ? await verifyEmailLink({ code })
        : null;

  if (!result || !result.ok) {
    if (result && result.errorCode !== "otp_expired") logServerError("auth/confirm", result);
    redirect(`${isPasswordReset ? ROUTES.resetPassword : ROUTES.signIn}?notice=link-invalid`);
  }

  if (isPasswordReset) redirect(ROUTES.updatePassword);

  const destination = new URL(next, "http://localhost");
  destination.searchParams.set("notice", "email-confirmed");
  redirect(`${destination.pathname}${destination.search}`);
}
