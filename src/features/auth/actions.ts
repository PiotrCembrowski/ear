"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { DEFAULT_SIGNED_IN_PATH, ROUTES, safeRedirectPath } from "@/lib/auth/routes";
import { getPublicEnv } from "@/lib/config/public-env";
import { logServerError } from "@/lib/logging";
import * as authService from "@/lib/services/auth";
import { resetRequestSchema, signInSchema, signUpSchema, updatePasswordSchema } from "@/lib/validation/auth";
import { authErrorMessage } from "./auth-errors";
import { formText, validationErrorState, type FormState } from "./form-state";

/**
 * Auth Server Actions. Each one: validate input with Zod → call the auth
 * service → return a FormState for the form, or redirect on success.
 * Next.js checks the request Origin for Server Actions (CSRF protection).
 *
 * Note: redirect() works by throwing, so it is always called outside try/catch.
 */

function authFailureState(
  context: string,
  result: { errorCode: string; status?: number; detail: string },
  values?: Record<string, string>,
): FormState {
  // Expected user errors (wrong password etc.) are not worth a server log entry.
  const expected = ["invalid_credentials", "email_not_confirmed", "weak_password", "same_password", "otp_expired"];
  if (!expected.includes(result.errorCode)) logServerError(context, result);
  return { status: "error", message: authErrorMessage(result.errorCode, result.status), values };
}

function siteUrl(path: string): string {
  return new URL(path, getPublicEnv().NEXT_PUBLIC_SITE_URL).toString();
}

export async function signInAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = { email: formText(formData, "email") };
  const parsed = signInSchema.safeParse({ email: values.email, password: formText(formData, "password") });
  if (!parsed.success) return validationErrorState(parsed.error, values);

  const result = await authService.signInWithPassword(parsed.data.email, parsed.data.password);
  if (!result.ok) return authFailureState("signIn", result, values);

  redirect(safeRedirectPath(formText(formData, "next")));
}

export async function signUpAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = { email: formText(formData, "email"), displayName: formText(formData, "displayName") };
  const parsed = signUpSchema.safeParse({
    ...values,
    password: formText(formData, "password"),
    confirmPassword: formText(formData, "confirmPassword"),
  });
  if (!parsed.success) return validationErrorState(parsed.error, values);

  const result = await authService.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    displayName: parsed.data.displayName,
    emailRedirectTo: siteUrl(`${ROUTES.authConfirm}?next=${encodeURIComponent(DEFAULT_SIGNED_IN_PATH)}`),
  });
  if (!result.ok) return authFailureState("signUp", result, values);

  if (result.outcome === "signed_in") redirect(DEFAULT_SIGNED_IN_PATH);
  return {
    status: "success",
    message: `We've sent a confirmation link to ${parsed.data.email}. Open it to finish creating your account.`,
  };
}

export async function requestPasswordResetAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const values = { email: formText(formData, "email") };
  const parsed = resetRequestSchema.safeParse(values);
  if (!parsed.success) return validationErrorState(parsed.error, values);

  const result = await authService.requestPasswordReset(
    parsed.data.email,
    siteUrl(`${ROUTES.authConfirm}?next=${encodeURIComponent(ROUTES.updatePassword)}`),
  );
  // Only rate limits are reported; otherwise we show the same message whether
  // or not an account exists, so this form can't be used to probe emails.
  if (!result.ok && (result.status === 429 || result.errorCode.startsWith("over_"))) {
    return authFailureState("requestPasswordReset", result, values);
  }
  if (!result.ok) logServerError("requestPasswordReset", result);
  return {
    status: "success",
    message: `If an account exists for ${parsed.data.email}, we've sent it a link to choose a new password.`,
  };
}

export async function updatePasswordAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await getSessionUser();
  if (!user) {
    return {
      status: "error",
      message: "Your reset link has expired or you're signed out. Please request a new link.",
    };
  }
  const parsed = updatePasswordSchema.safeParse({
    password: formText(formData, "password"),
    confirmPassword: formText(formData, "confirmPassword"),
  });
  if (!parsed.success) return validationErrorState(parsed.error);

  const result = await authService.updatePassword(parsed.data.password);
  if (!result.ok) return authFailureState("updatePassword", result);

  redirect(`${ROUTES.settings}?notice=password-updated`);
}

export async function signOutAction(): Promise<void> {
  const result = await authService.signOut();
  if (!result.ok) logServerError("signOut", result);
  // Even if the server call failed, the local session cookie is cleared.
  redirect(`${ROUTES.signIn}?notice=signed-out`);
}
