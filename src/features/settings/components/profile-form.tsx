"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { FormMessage } from "@/features/auth/components/form-message";
import { INITIAL_FORM_STATE } from "@/features/auth/form-state";
import { updateProfileAction } from "../actions";

export function ProfileForm({ email, displayName }: { email: string | null; displayName: string | null }) {
  const [state, formAction] = useActionState(updateProfileAction, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <TextField label="Email" name="email" type="email" value={email ?? ""} readOnly disabled hint="Your sign-in email." />
      <TextField
        label="Display name"
        name="displayName"
        autoComplete="nickname"
        maxLength={80}
        hint="Shown in the app. Leave empty to use your email."
        defaultValue={state.values?.displayName ?? displayName ?? ""}
        errors={state.fieldErrors?.displayName}
      />
      <SubmitButton pendingLabel="Saving…" className="self-start">
        Save profile
      </SubmitButton>
    </form>
  );
}
