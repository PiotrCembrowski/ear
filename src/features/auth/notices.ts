import type { AlertTone } from "@/components/ui/alert";

/**
 * One-line messages shown after a redirect, selected by a `?notice=` code.
 * Only codes listed here are ever shown, so the URL can't inject text.
 */
export const NOTICES = {
  "signed-out": { tone: "info", text: "You've been signed out." },
  "password-updated": { tone: "success", text: "Your password has been updated." },
  "email-confirmed": { tone: "success", text: "Your email is confirmed. Welcome to SoundMatch!" },
  "link-invalid": { tone: "danger", text: "That link has expired or was already used. Please request a new one." },
  "session-ended": { tone: "info", text: "Your session has ended. Please sign in again." },
  "reference-created": { tone: "success", text: "Reference added. Its features were computed, so it's ready to compare." },
  "reference-deleted": { tone: "success", text: "Reference deleted." },
} as const satisfies Record<string, { tone: AlertTone; text: string }>;

export type NoticeCode = keyof typeof NOTICES;

export function readNotice(value: string | string[] | undefined): (typeof NOTICES)[NoticeCode] | null {
  const code = Array.isArray(value) ? value[0] : value;
  return code && Object.hasOwn(NOTICES, code) ? NOTICES[code as NoticeCode] : null;
}
