"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { FormMessage } from "@/features/auth/components/form-message";
import { INITIAL_FORM_STATE } from "@/features/auth/form-state";
import { deleteAccountAction } from "../actions";

export function DeleteAccountForm() {
  const [state, formAction] = useActionState(deleteAccountAction, INITIAL_FORM_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />
      <p className="text-sm text-ink-muted">
        This permanently deletes your account, your profile and your whole history. It can&apos;t be undone. (SoundMatch never stores your audio, so
        there is none to delete.)
      </p>
      <TextField
        label="Type DELETE to confirm"
        name="confirmation"
        autoComplete="off"
        spellCheck={false}
        errors={state.fieldErrors?.confirmation}
        className="max-w-xs"
      />
      <SubmitButton variant="danger" pendingLabel="Deleting…" className="self-start">
        Delete my account
      </SubmitButton>
    </form>
  );
}
