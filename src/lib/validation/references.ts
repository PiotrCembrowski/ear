import { z } from "zod";
import { REFERENCE_LIMITS } from "@/lib/config/app-config";
import { isValidVariant } from "@/lib/samples/sample-names";

/**
 * Admin input for reference sounds. Mirrors the database CHECK constraints
 * (see the core schema migration), so users get friendly messages before the
 * database has to reject anything.
 */

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((value) => (value === "" ? null : value));

/** Tags: comma-separated in forms; lowercase words or hyphenated words, at most 20. */
export const tagsSchema = z
  .string()
  .transform((value) =>
    [
      ...new Set(
        value
          .split(",")
          .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
          .filter(Boolean),
      ),
    ],
  )
  .pipe(
    z
      .array(z.string().max(30, "Each tag can be at most 30 characters.").regex(/^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u, "Tags can use letters, numbers and hyphens."))
      .max(20, "Use at most 20 tags."),
  );

/** License and provenance: required for every reference (spec 4E). */
export const provenanceSchema = z
  .object({
    license: z.string().trim().min(1, "Enter the license (e.g. CC0-1.0, CC-BY-3.0).").max(200, "Use at most 200 characters."),
    sourceUrl: z
      .string()
      .trim()
      .max(500, "Use at most 500 characters.")
      .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Enter a full link starting with http:// or https://.")
      .transform((v) => (v === "" ? null : v)),
    attribution: optionalText(500, "Use at most 500 characters."),
  })
  .refine((p) => p.sourceUrl !== null || p.attribution !== null, {
    path: ["sourceUrl"],
    message: "Add a source link or an attribution, so the sound's origin is documented.",
  });

export const referenceMetadataSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(120, "Use at most 120 characters."),
    description: optionalText(2000, "Use at most 2000 characters."),
    categoryId: z.uuid({ message: "Choose a category." }),
    tags: tagsSchema,
    visibility: z.enum(["public", "private"], { message: "Choose who can see it." }),
    isSynthetic: z.boolean(),
  })
  .and(provenanceSchema);

export type ReferenceMetadataInput = z.infer<typeof referenceMetadataSchema>;

/** What the browser reports about a normalized file it uploaded (re-checked on the server). */
export const uploadedFileSchema = z.object({
  storagePath: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*\.wav$/, "Invalid storage path.")
    .refine((p) => !p.includes(".."), "Invalid storage path.")
    .max(300),
  originalFilename: z.string().trim().max(255).nullable(),
});

export const sampleTargetSchema = z.object({
  instrumentId: z.uuid({ message: "Choose an instrument." }),
  variant: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidVariant, "Use lowercase letters, numbers and hyphens, e.g. grand-default."),
  midiNote: z.number().int().min(0).max(127),
  velocity: z.number().int().min(1).max(127).nullable(),
});

/** Shared batch settings for a bulk import. */
export const importSettingsSchema = z
  .object({
    instrumentId: z.uuid({ message: "Choose an instrument." }),
    variant: sampleTargetSchema.shape.variant,
    visibility: z.enum(["public", "private"]),
  })
  .and(provenanceSchema);

export const REFERENCE_UPLOAD_LIMITS = {
  maxStoredBytes: REFERENCE_LIMITS.maxStoredBytes,
  maxImportFileBytes: REFERENCE_LIMITS.maxImportFileBytes,
} as const;
