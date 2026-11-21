import { describe, expect, it } from "vitest";
import { decideProxyAction, isProtectedPath, safeRedirectPath } from "./routes";

describe("safeRedirectPath", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/history?mode=compare#top", "/history?mode=compare#top"],
    ["/settings/../dashboard", "/dashboard"],
  ])("allows same-site path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["dashboard"],
    ["https://evil.example/"],
    ["//evil.example"],
    ["/\\evil.example"],
  ])("falls back for unsafe or missing value %s", (input) => {
    expect(safeRedirectPath(input)).toBe("/dashboard");
  });

  it("keeps percent-encoded control characters encoded (harmless, same-site)", () => {
    const result = safeRedirectPath("/%0d%0aSet-Cookie:x");
    expect(result.startsWith("/")).toBe(true);
    expect(result).not.toMatch(/[\r\n]/);
  });

  it("rejects raw control characters and overly long values", () => {
    expect(safeRedirectPath("/a\nb")).toBe("/dashboard");
    expect(safeRedirectPath(`/${"a".repeat(600)}`)).toBe("/dashboard");
  });

  it("uses the given fallback", () => {
    expect(safeRedirectPath("https://evil.example", "/settings")).toBe("/settings");
  });
});

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/dashboard/x", "/settings", "/history", "/library/abc", "/admin/import"])("protects %s", (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });
  it.each(["/", "/sign-in", "/listen", "/dashboards", "/settingsx", "/auth/confirm"])("does not protect %s", (p) => {
    expect(isProtectedPath(p)).toBe(false);
  });
});

describe("decideProxyAction", () => {
  it("sends signed-out users from protected pages to sign-in, remembering where they were", () => {
    expect(decideProxyAction("/history", "?q=a4", false)).toEqual({
      type: "redirect",
      to: "/sign-in?next=%2Fhistory%3Fq%3Da4",
    });
  });
  it("sends signed-in users away from sign-in/sign-up to the dashboard", () => {
    expect(decideProxyAction("/sign-in", "", true)).toEqual({ type: "redirect", to: "/dashboard" });
    expect(decideProxyAction("/sign-up", "", true)).toEqual({ type: "redirect", to: "/dashboard" });
  });
  it("lets everything else through", () => {
    expect(decideProxyAction("/dashboard", "", true)).toEqual({ type: "continue" });
    expect(decideProxyAction("/", "", false)).toEqual({ type: "continue" });
    expect(decideProxyAction("/update-password", "", false)).toEqual({ type: "continue" });
  });
});
