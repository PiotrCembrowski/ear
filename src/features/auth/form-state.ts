import type { z } from "zod";

/**
 * What a Server Action returns to its form (via useActionState).
 * `values` lets the form keep what the user typed after an error
 * (never includes passwords).
 */
export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  values?: Record<string, string>;
};

export const INITIAL_FORM_STATE: FormState = { status: "idle" };

export function validationErrorState(error: z.ZodError, values?: Record<string, string>): FormState {
  const fieldErrors: Record<string, string[] | undefined> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values };
}

/** Reads a text field from FormData ("" when missing or a file). */
export function formText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
