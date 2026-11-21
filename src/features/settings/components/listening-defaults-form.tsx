"use client";

import { useActionState, useState } from "react";
import { CheckboxField } from "@/components/ui/fields";
import { SubmitButton } from "@/components/ui/submit-button";
import { TextField } from "@/components/ui/text-field";
import { FormMessage } from "@/features/auth/components/form-message";
import { INITIAL_FORM_STATE } from "@/features/auth/form-state";
import { SensitivityControl } from "@/features/listen/components/sensitivity-control";
import { A4 } from "@/lib/config/app-config";
import type { ProfileSettings } from "@/lib/validation/profile";
import { updateSettingsAction } from "../actions";

/** A4 reference, default sensitivity and history saving: stored in the profile, so they follow the user across devices. */
export function ListeningDefaultsForm({ settings }: { settings: ProfileSettings }) {
  const [state, formAction] = useActionState(updateSettingsAction, INITIAL_FORM_STATE);
  const [sensitivity, setSensitivity] = useState(settings.sensitivityDb);
  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormMessage state={state} />
      <TextField
        label="Reference pitch (A4)"
        name="a4Hz"
        type="number"
        inputMode="decimal"
        min={A4.minHz}
        max={A4.maxHz}
        step={0.1}
        defaultValue={state.values?.a4Hz ?? String(settings.a4Hz)}
        hint="Notes are named relative to this. 440 Hz is standard; some orchestras and pianos use 442 or 443."
        errors={state.fieldErrors?.a4Hz}
        className="max-w-xs"
      />
      <div className="max-w-md">
        <input type="hidden" name="sensitivityDb" value={sensitivity} />
        <SensitivityControl value={sensitivity} onChange={setSensitivity} />
      </div>
      <CheckboxField
        label="Save results to my history automatically"
        name="saveHistory"
        defaultChecked={settings.saveHistory}
        hint="Only summaries are saved (scores, notes, measurements), never audio. You can still save a result manually when this is off."
      />
      <SubmitButton pendingLabel="Saving…" className="self-start">
        Save listening settings
      </SubmitButton>
    </form>
  );
}
