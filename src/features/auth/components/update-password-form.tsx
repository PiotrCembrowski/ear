"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";
import { updatePasswordAction } from "../actions";
import { INITIAL_FORM_STATE } from "../form-state";
import { FormMessage } from "./form-message";

/** Used both after a reset link and on the Settings page. */
export function UpdatePasswordForm({ submitLabel = "Save new password" }: { submitLabel?: string }) {
  const [state, formAction] = useActionState(updatePasswordAction, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <TextField
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        required
        errors={state.fieldErrors?.password}
      />
      <TextField
        label="Repeat new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        errors={state.fieldErrors?.confirmPassword}
      />
      <SubmitButton pendingLabel="Saving…" className="self-start">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
