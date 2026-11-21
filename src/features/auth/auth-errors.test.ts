import { describe, expect, it } from "vitest";
import { authErrorMessage, GENERIC_AUTH_ERROR } from "./auth-errors";

describe("authErrorMessage", () => {
  it("maps known Supabase codes to friendly text", () => {
    expect(authErrorMessage("invalid_credentials")).toMatch(/don't match/);
    expect(authErrorMessage("otp_expired")).toMatch(/expired/);
  });
  it("treats unknown 429 responses as rate limiting", () => {
    expect(authErrorMessage("something_new", 429)).toMatch(/Too many attempts/);
  });
  it("never leaks unknown codes or raw messages", () => {
    expect(authErrorMessage("unexpected_failure", 500)).toBe(GENERIC_AUTH_ERROR);
  });
});
