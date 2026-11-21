"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formText, validationErrorState, type FormState } from "@/features/auth/form-state";
import { requireUser } from "@/lib/auth/session";
import { ROUTES } from "@/lib/auth/routes";
import { logServerError } from "@/lib/logging";
import { deleteUserAccount } from "@/lib/services/account";
import { signOut } from "@/lib/services/auth";
import { updateOwnDisplayName, updateOwnSettings } from "@/lib/services/profiles";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { deleteAccountSchema, settingsFormSchema, updateProfileSchema } from "@/lib/validation/profile";

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

export async function updateSettingsAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(ROUTES.settings);
  const values = { a4Hz: formText(formData, "a4Hz"), sensitivityDb: formText(formData, "sensitivityDb") };
  const parsed = settingsFormSchema.safeParse({ ...values, saveHistory: formData.get("saveHistory") === "on" });
  if (!parsed.success) return validationErrorState(parsed.error, values);
  try {
    await updateOwnSettings(user.id, parsed.data);
  } catch (error) {
    logServerError("updateSettings", error, { userId: user.id });
    return { status: "error", message: "We couldn't save your settings. Please try again.", values };
  }
  revalidatePath("/", "layout");
  return { status: "success", message: "Settings saved. They apply the next time you open the Listen screen." };
}

/**
 * Deletes the signed-in user's account and everything linked to it, then
 * signs them out. Irreversible, so the form asks for "DELETE" first.
 */
export async function deleteAccountAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser(ROUTES.settings);
  const parsed = deleteAccountSchema.safeParse({ confirmation: formText(formData, "confirmation") });
  if (!parsed.success) return validationErrorState(parsed.error);
  try {
    await deleteUserAccount(createAdminSupabase(), user.id);
  } catch (error) {
    logServerError("deleteAccount", error, { userId: user.id });
    return { status: "error", message: "We couldn't delete your account. Please try again, or contact the site owner." };
  }
  // Clear this browser's session cookies (the user no longer exists).
  await signOut().catch(() => undefined);
  redirect(`${ROUTES.signIn}?notice=account-deleted`);
}
