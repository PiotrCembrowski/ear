/**
 * Route rules shared by proxy.ts (fast, cookie-based redirects) and server
 * code. Pure functions with no Next.js imports, so they are easy to test.
 *
 * Remember: proxy redirects are only a convenience. Every protected page and
 * route handler ALSO checks the user on the server (requireUser), and the
 * database enforces Row Level Security regardless.
 */

export const ROUTES = {
  home: "/",
  signIn: "/sign-in",
  signUp: "/sign-up",
  resetPassword: "/reset-password",
  updatePassword: "/update-password",
  authConfirm: "/auth/confirm",
  dashboard: "/dashboard",
  listen: "/listen",
  settings: "/settings",
} as const;

/** Where users land after signing in when no (valid) `next` is given. */
export const DEFAULT_SIGNED_IN_PATH = ROUTES.dashboard;

/** Paths (and everything below them) that need a signed-in user. */
const PROTECTED_PREFIXES = ["/dashboard", "/settings", "/history", "/library", "/admin"] as const;

/** Pages that make no sense while signed in (we send those users to the dashboard). */
const SIGNED_OUT_ONLY_PATHS = [ROUTES.signIn, ROUTES.signUp, ROUTES.resetPassword] as const;

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix));
}

export function isSignedOutOnlyPath(pathname: string): boolean {
  return (SIGNED_OUT_ONLY_PATHS as readonly string[]).includes(pathname);
}

/**
 * Makes a user-supplied `next` value safe to redirect to. Only same-site
 * relative paths are allowed, so `?next=https://evil.example` or
 * `?next=//evil.example` cannot turn our sign-in page into an open redirect.
 */
export function safeRedirectPath(next: string | null | undefined, fallback: string = DEFAULT_SIGNED_IN_PATH): string {
  if (!next || typeof next !== "string") return fallback;
  if (next.length > 512) return fallback;
  // Must be a path on this site: starts with exactly one "/" and no backslash
  // tricks (some browsers treat "/\evil.com" as "//evil.com").
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  // Reject control characters, which some parsers strip and then misread.
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  try {
    const parsed = new URL(next, "http://localhost");
    if (parsed.origin !== "http://localhost") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function signInPathWithNext(next: string): string {
  return `${ROUTES.signIn}?next=${encodeURIComponent(next)}`;
}

export type ProxyDecision = { type: "continue" } | { type: "redirect"; to: string };

/** What proxy.ts should do for a request, given whether a session cookie verified. */
export function decideProxyAction(pathname: string, search: string, isSignedIn: boolean): ProxyDecision {
  if (!isSignedIn && isProtectedPath(pathname)) {
    return { type: "redirect", to: signInPathWithNext(`${pathname}${search}`) };
  }
  if (isSignedIn && isSignedOutOnlyPath(pathname)) {
    return { type: "redirect", to: DEFAULT_SIGNED_IN_PATH };
  }
  return { type: "continue" };
}
