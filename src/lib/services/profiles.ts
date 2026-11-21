import "server-only";

import type { ProfileRole } from "@/lib/supabase/database.types";
import { createServerSupabase } from "@/lib/supabase/server";
import { readProfileSettings, type ProfileSettings } from "@/lib/validation/profile";
import { ServiceError } from "./errors";

/**
 * Profile data access. Runs as the signed-in user, so Row Level Security
 * limits every query to their own row (admins may read others).
 */

export type Profile = {
  id: string;
  displayName: string | null;
  role: ProfileRole;
  settings: ProfileSettings;
  createdAt: string;
};

export async function getOwnProfile(userId: string): Promise<Profile | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, settings, created_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new ServiceError("Could not load profile", error);
  if (!data) return null;
  return {
    id: data.id,
    displayName: data.display_name,
    role: data.role,
    settings: readProfileSettings(data.settings),
    createdAt: data.created_at,
  };
}

export async function updateOwnDisplayName(userId: string, displayName: string | null): Promise<void> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId)
    .select("id");
  if (error) throw new ServiceError("Could not update profile", error);
  if (!data || data.length !== 1) throw new ServiceError("Profile not found or not permitted");
}

/** Replaces the user's settings (already validated). RLS limits the update to their own row. */
export async function updateOwnSettings(userId: string, settings: ProfileSettings): Promise<void> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.from("profiles").update({ settings }).eq("id", userId).select("id");
  if (error) throw new ServiceError("Could not update settings", error);
  if (!data || data.length !== 1) throw new ServiceError("Profile not found or not permitted");
}
