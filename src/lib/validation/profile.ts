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

/** Settings form: numbers arrive as text, the checkbox as "on" or missing. */
const a4Message = `Use a value between ${A4.minHz} and ${A4.maxHz} Hz (440 is standard).`;
export const settingsFormSchema = z.object({
  a4Hz: z.coerce
    .number({ message: a4Message })
    .min(A4.minHz, a4Message)
    .max(A4.maxHz, a4Message)
    .transform((v) => Math.round(v * 10) / 10),
  sensitivityDb: z.coerce
    .number({ message: "Choose a sensitivity." })
    .min(SENSITIVITY_DB.min, "Choose a sensitivity.")
    .max(SENSITIVITY_DB.max, "Choose a sensitivity.")
    .transform((v) => Math.round(v)),
  saveHistory: z.boolean(),
});

/** Account deletion must be confirmed by typing DELETE. */
export const deleteAccountSchema = z.object({
  confirmation: z.string().trim().refine((v) => v === "DELETE", "Type DELETE (in capitals) to confirm."),
});
