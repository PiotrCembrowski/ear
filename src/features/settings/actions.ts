"use server";

import { revalidatePath } from "next/cache";
import { formText, validationErrorState, type FormState } from "@/features/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import { ROUTES } from "@/lib/auth/routes";
import { logServerError } from "@/lib/logging";
import { updateOwnDisplayName } from "@/lib/services/profiles";
import { updateProfileSchema } from "@/lib/validation/profile";

export async function updateProfileAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(ROUTES.settings);
  const values = { displayName: formText(formData, "displayName") };
  const parsed = updateProfileSchema.safeParse(values);
  if (!parsed.success) return validationErrorState(parsed.error, values);

  try {
    await updateOwnDisplayName(user.id, parsed.data.displayName);
  } catch (error) {
    logServerError("updateProfile", error, { userId: user.id });
    return { status: "error", message: "We couldn't save your profile. Please try again.", values };
  }

  // The display name appears in the sidebar on every page.
  revalidatePath("/", "layout");
  return { status: "success", message: "Profile saved.", values: { displayName: parsed.data.displayName ?? "" } };
}
