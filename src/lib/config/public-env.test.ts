import { afterEach, describe, expect, it, vi } from "vitest";

/** getPublicEnv() caches its result, so each test loads a fresh module copy. */
async function loadWithEnv(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  return import("./public-env");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPublicEnv", () => {
  it("returns validated values and defaults the site URL", async () => {
    const { getPublicEnv } = await loadWithEnv({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
      NEXT_PUBLIC_SITE_URL: "",
    });
    expect(getPublicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_0123456789abcdef",
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
    });
  });

  it("throws a readable error when configuration is missing or invalid", async () => {
    const { getPublicEnv } = await loadWithEnv({
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    });
    expect(() => getPublicEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL must be a URL[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });
});
