"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { logServerError } from "@/lib/logging";
import { deleteComparison } from "@/lib/services/comparisons";
import { createServerSupabase } from "@/lib/supabase/server";

/** Deletes one of the user's own history entries. RLS refuses anyone else's; there are no files to remove. */
export async function deleteComparisonAction(id: string): Promise<{ ok: boolean; message?: string }> {
  await requireUser("/history");
  try {
    const deleted = await deleteComparison(await createServerSupabase(), id);
    if (!deleted) return { ok: false, message: "That entry no longer exists." };
  } catch (error) {
    logServerError("deleteComparison", error, { id });
    return { ok: false, message: "Couldn't delete it. Please try again." };
  }
  revalidatePath("/history");
  return { ok: true };
}
