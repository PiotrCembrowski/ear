"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";
import { signUpAction } from "../actions";
import { INITIAL_FORM_STATE } from "../form-state";
import { FormMessage } from "./form-message";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, INITIAL_FORM_STATE);

  // After a successful sign-up we only show the "check your email" message.
  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <TextField
        label="Display name (optional)"
        name="displayName"
        autoComplete="nickname"
        maxLength={80}
        defaultValue={state.values?.displayName}
        errors={state.fieldErrors?.displayName}
      />
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.values?.email}
        errors={state.fieldErrors?.email}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easier to remember and harder to guess.`}
        required
        errors={state.fieldErrors?.password}
      />
      <TextField
        label="Repeat password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton pendingLabel="Creating account…" fullWidth size="lg">
        Create account
      </SubmitButton>
    </form>
  );
}
