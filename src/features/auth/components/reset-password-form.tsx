"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { requestPasswordResetAction } from "../actions";
import { INITIAL_FORM_STATE } from "../form-state";
import { FormMessage } from "./form-message";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, INITIAL_FORM_STATE);

  if (state.status === "success") return <FormMessage state={state} />;

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
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
      <SubmitButton pendingLabel="Sending link…" fullWidth size="lg">
        Send reset link
      </SubmitButton>
    </form>
  );
}
