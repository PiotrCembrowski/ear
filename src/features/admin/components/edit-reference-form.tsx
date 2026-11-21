"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/features/auth/components/form-message";
import type { Category } from "@/lib/services/references";
import { updateReferenceAction } from "../actions";
import type { MetadataFormState } from "../form-data";
import { ReferenceMetadataFields, type MetadataDefaults } from "./reference-metadata-fields";

export function EditReferenceForm({ referenceId, categories, defaults }: { referenceId: string; categories: Category[]; defaults: MetadataDefaults }) {
  const [state, formAction] = useActionState<MetadataFormState, FormData>(updateReferenceAction.bind(null, referenceId), { status: "idle" });
  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <ReferenceMetadataFields categories={categories} defaults={defaults} errors={state.fieldErrors} />
      <SubmitButton pendingLabel="Saving…" className="self-start">
        Save changes
      </SubmitButton>
    </form>
  );
}
