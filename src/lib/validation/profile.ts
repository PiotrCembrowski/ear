import { z } from "zod";
import { A4, SENSITIVITY_DB } from "@/lib/config/app-config";
import { displayNameSchema } from "./auth";

/**
 * Shape of `profiles.settings` (jsonb). The database repeats the key range
 * checks, so a bad value can never be stored even by a buggy client.
 *
 * Reading is forgiving: missing or invalid values fall back to defaults
 * (`.catch`), so an old or partially-filled settings object never breaks a
 * page. Writing uses the strict schema.
 */
export const profileSettingsStrictSchema = z.object({
  a4Hz: z.number().min(A4.minHz).max(A4.maxHz),
  sensitivityDb: z.number().min(SENSITIVITY_DB.min).max(SENSITIVITY_DB.max),
  saveHistory: z.boolean(),
});

export type ProfileSettings = z.infer<typeof profileSettingsStrictSchema>;

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  a4Hz: A4.defaultHz,
  sensitivityDb: SENSITIVITY_DB.default,
  saveHistory: true,
};

const profileSettingsReadSchema = z.object({
  a4Hz: profileSettingsStrictSchema.shape.a4Hz.catch(DEFAULT_PROFILE_SETTINGS.a4Hz),
  sensitivityDb: profileSettingsStrictSchema.shape.sensitivityDb.catch(DEFAULT_PROFILE_SETTINGS.sensitivityDb),
  saveHistory: profileSettingsStrictSchema.shape.saveHistory.catch(DEFAULT_PROFILE_SETTINGS.saveHistory),
});

export function readProfileSettings(raw: unknown): ProfileSettings {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return profileSettingsReadSchema.parse({ ...DEFAULT_PROFILE_SETTINGS, ...source });
}

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
});
