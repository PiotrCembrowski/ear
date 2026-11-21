import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { ServiceError } from "./errors";

/**
 * Permanently deletes a user (secret-key client). The database removes the
 * rest by cascade: profile, history (comparisons) and rate-limit counters.
 * Reference sounds they own (admins only) stay, ownerless. SoundMatch never
 * stores user audio, so there are no files to delete.
 */
export async function deleteUserAccount(adminClient: SupabaseClient<Database>, userId: string): Promise<void> {
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) throw new ServiceError("Could not delete the account", error);
}
