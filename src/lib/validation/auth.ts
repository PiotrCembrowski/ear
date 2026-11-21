import { z } from "zod";

/**
 * Supabase hashes passwords with bcrypt, which only uses the first 72 bytes,
 * so longer passwords are rejected instead of silently truncated. Your
 * Supabase project may enforce stricter rules (Auth → Policies); its error
 * messages are mapped in src/features/auth/auth-errors.ts.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export const emailSchema = z
  .string({ message: "Enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email({ message: "Enter a valid email address, like name@example.com." }));

export const newPasswordSchema = z
  .string({ message: "Enter a password." })
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES, {
    message: `Use at most ${PASSWORD_MAX_BYTES} characters.`,
  });

export const displayNameSchema = z
  .string()
  .trim()
  .max(80, "Use at most 80 characters.")
  .transform((value) => (value === "" ? null : value));

export const signInSchema = z.object({
  email: emailSchema,
  // No length rules on sign-in: just check something was typed.
  password: z.string({ message: "Enter your password." }).min(1, "Enter your password."),
});

export const signUpSchema = z
  .object({
    displayName: displayNameSchema,
    email: emailSchema,
    password: newPasswordSchema,
    confirmPassword: z.string({ message: "Repeat your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

export const resetRequestSchema = z.object({ email: emailSchema });

export const updatePasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string({ message: "Repeat your password." }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

/** Email-link verification types Supabase sends to /auth/confirm. */
export const emailOtpTypeSchema = z.enum(["signup", "email", "recovery", "invite", "magiclink", "email_change"]);
