import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema, updatePasswordSchema } from "./auth";
import { DEFAULT_PROFILE_SETTINGS, readProfileSettings, updateProfileSchema } from "./profile";

describe("auth schemas", () => {
  it("normalizes email (trim + lowercase)", () => {
    const parsed = signInSchema.parse({ email: "  Alice@Example.COM ", password: "x" });
    expect(parsed.email).toBe("alice@example.com");
  });

  it("rejects invalid email and empty password with friendly messages", () => {
    const result = signInSchema.safeParse({ email: "not-an-email", password: "" });
    expect(result.success).toBe(false);
    const messages = result.error!.issues.map((i) => i.message);
    expect(messages).toContain("Enter a valid email address, like name@example.com.");
    expect(messages).toContain("Enter your password.");
  });

  it("sign-up requires 8+ characters, at most 72 bytes, and matching confirmation", () => {
    const base = { displayName: "", email: "a@b.co" };
    expect(signUpSchema.safeParse({ ...base, password: "short", confirmPassword: "short" }).success).toBe(false);
    expect(signUpSchema.safeParse({ ...base, password: "longenough", confirmPassword: "different" }).error?.issues[0]?.path).toEqual([
      "confirmPassword",
    ]);
    // 25 three-byte characters = 75 bytes > 72
    const tooLong = "€".repeat(25);
    expect(signUpSchema.safeParse({ ...base, password: tooLong, confirmPassword: tooLong }).success).toBe(false);
    const ok = signUpSchema.parse({ ...base, password: "longenough", confirmPassword: "longenough" });
    expect(ok.displayName).toBeNull(); // empty display name becomes null
  });

  it("update-password requires matching passwords", () => {
    expect(updatePasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "newpassword1" }).success).toBe(true);
    expect(updatePasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "nope" }).success).toBe(false);
  });
});

describe("profile schemas", () => {
  it("trims display names and limits them to 80 characters", () => {
    expect(updateProfileSchema.parse({ displayName: "  Ada  " }).displayName).toBe("Ada");
    expect(updateProfileSchema.safeParse({ displayName: "x".repeat(81) }).success).toBe(false);
  });

  it("reads settings forgivingly, falling back to defaults per field", () => {
    expect(readProfileSettings({})).toEqual(DEFAULT_PROFILE_SETTINGS);
    expect(readProfileSettings(null)).toEqual(DEFAULT_PROFILE_SETTINGS);
    expect(readProfileSettings({ a4Hz: 442, sensitivityDb: "loud", saveHistory: false })).toEqual({
      a4Hz: 442,
      sensitivityDb: DEFAULT_PROFILE_SETTINGS.sensitivityDb,
      saveHistory: false,
    });
    expect(readProfileSettings({ a4Hz: 9999 }).a4Hz).toBe(440);
  });
});
