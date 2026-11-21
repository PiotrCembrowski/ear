/**
 * Turns Supabase Auth error codes into messages people can act on.
 * Raw Supabase messages are never shown; they are logged on the server.
 */
const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match. Check them and try again.",
  email_not_confirmed: "Please confirm your email address first. Check your inbox for the link we sent.",
  user_banned: "This account has been suspended.",
  weak_password: "That password is too easy to guess. Try a longer one with a mix of words, numbers and symbols.",
  same_password: "Your new password must be different from your current one.",
  email_address_invalid: "That email address can't be used. Please try another.",
  email_address_not_authorized: "Sign-up emails can't be sent to that address yet. Please try another.",
  signup_disabled: "New sign-ups are currently turned off.",
  email_provider_disabled: "Email sign-in is currently turned off.",
  over_request_rate_limit: "Too many attempts. Please wait a minute and try again.",
  over_email_send_rate_limit: "We've sent too many emails recently. Please wait a few minutes and try again.",
  otp_expired: "This link has expired or was already used. Please request a new one.",
  flow_state_expired: "This link has expired. Please request a new one.",
  flow_state_not_found: "This link isn't valid in this browser. Please open it in the browser you used to sign up, or request a new one.",
  bad_code_verifier: "This link isn't valid in this browser. Please open it in the browser you used to sign up, or request a new one.",
  session_not_found: "Your session has ended. Please sign in again.",
  session_expired: "Your session has ended. Please sign in again.",
  reauthentication_needed: "For your security, please sign in again before changing your password.",
};

export const GENERIC_AUTH_ERROR = "Something went wrong on our side. Please try again in a moment.";

export function authErrorMessage(code: string, status?: number): string {
  const known = MESSAGES[code];
  if (known) return known;
  if (status === 429) return MESSAGES.over_request_rate_limit!;
  return GENERIC_AUTH_ERROR;
}
