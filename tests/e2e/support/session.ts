import type { BrowserContext } from "@playwright/test";

/**
 * Signs a browser context in against the fake Supabase (tests/e2e/support/fake-supabase.ts)
 * by setting the same session cookie @supabase/ssr would. The JWT is unsigned
 * test data: the fake server only reads its "sub".
 */
export async function signInAs(context: BrowserContext, userId: string, baseURL: string): Promise<void> {
  const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: userId, role: "authenticated", aud: "authenticated", exp, iat: exp - 3600 })}.test`;
  const session = { access_token: accessToken, refresh_token: "test", token_type: "bearer", expires_in: 3600, expires_at: exp, user: { id: userId } };
  // Cookie name: sb-<first label of the Supabase host>-auth-token (host 127.0.0.1 → "127").
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${b64url(session)}`, url: baseURL }]);
}
