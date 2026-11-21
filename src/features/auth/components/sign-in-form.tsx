"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { ROUTES } from "@/lib/auth/routes";
import { signInAction } from "../actions";
import { INITIAL_FORM_STATE } from "../form-state";
import { FormMessage } from "./form-message";

export function SignInForm({ next }: { next: string }) {
  const [state, formAction] = useActionState(signInAction, INITIAL_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next} />
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
      <div className="flex flex-col gap-2">
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          errors={state.fieldErrors?.password}
        />
        <Link href={ROUTES.resetPassword} className="self-end text-sm text-brand-strong hover:underline">
          Forgot your password?
        </Link>
      </div>
      <SubmitButton pendingLabel="Signing in…" fullWidth size="lg">
        Sign in
      </SubmitButton>
    </form>
  );
}
