"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { analyzeReferenceWav, identifyNote, ReferenceAudioError, type PitchFeatures, type ReferenceMeta } from "@/lib/audio-engine";
import { requireAdmin, type SessionUser } from "@/lib/auth/session";
import { logServerError } from "@/lib/logging";
import { createServerSupabase } from "@/lib/supabase/server";
import { sampleDisplayName, sampleStoragePath, soundStoragePath } from "@/lib/samples/sample-names";
import { storeFeatures, computeAndStoreFeatures, listOutdatedReferenceIds, deleteStaleFeatures } from "@/lib/services/reference-features";
import {
  createUploadTarget,
  deleteReference,
  downloadReferenceFile,
  existingSampleKeys,
  insertInstrumentSample,
  insertReference,
  listCategories,
  listInstruments,
  removeReferenceFile,
  sampleKey,
  updateReference,
  type Instrument,
  type ReferenceMetadata,
} from "@/lib/services/references";
import { importSettingsSchema, referenceMetadataSchema, sampleTargetSchema, uploadedFileSchema } from "@/lib/validation/references";
import { metadataFromForm, type MetadataFormState } from "./form-data";

/**
 * Admin Server Actions for reference sounds. Every action checks the admin
 * role on the server (requireAdmin) and runs with the admin's own Supabase
 * client, so Row Level Security enforces the same rule in the database.
 *
 * Upload flow (files never pass through our server):
 *   1. prepare…Upload: validate, compute the storage path HERE (never trust a
 *      path from the browser), check for duplicates, return a signed upload URL.
 *   2. The browser uploads the normalized WAV to that URL.
 *   3. finalize…: re-check the path, download and validate the WAV, insert the
 *      rows, compute and store features. Any failure rolls everything back.
 */

export type ActionResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[] | undefined>; code?: string };

type UploadTarget = { path: string; token: string };

export type FinalizedReference = {
  id: string;
  durationMs: number;
  /** For instrument samples: the note the engine actually hears (catches mislabelled files). */
  detected: { name: string; midi: number; cents: number } | null;
};

const ADMIN_PATHS = ["/admin/references", "/library"];
const revalidateAdmin = () => ADMIN_PATHS.forEach((path) => revalidatePath(path));

function fieldErrorsOf(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[String(issue.path[0] ?? "form")] ??= []).push(issue.message);
  return fieldErrors;
}

function failure(context: string, error: unknown, fallback = "Something went wrong. Please try again."): { ok: false; message: string; code?: string } {
  if (error instanceof ReferenceAudioError) return { ok: false, message: error.message, code: error.code };
  logServerError(context, error);
  return { ok: false, message: fallback };
}

async function findInstrument(instrumentId: string): Promise<Instrument | null> {
  const instruments = await listInstruments(await createServerSupabase());
  return instruments.find((i) => i.id === instrumentId) ?? null;
}

// ---------------------------------------------------------------------------
// Single reference sound
// ---------------------------------------------------------------------------

export async function prepareSoundUpload(rawMetadata: unknown): Promise<ActionResult<UploadTarget>> {
  await requireAdmin("/admin/references/new");
  const parsed = referenceMetadataSchema.safeParse(rawMetadata);
  if (!parsed.success) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  try {
    const client = await createServerSupabase();
    const category = (await listCategories(client)).find((c) => c.id === parsed.data.categoryId);
    if (!category) return { ok: false, message: "Please fix the highlighted fields.", fieldErrors: { categoryId: ["Choose a category."] } };
    return { ok: true, value: await createUploadTarget(client, soundStoragePath(category.slug, randomUUID())) };
  } catch (error) {
    return failure("prepareSoundUpload", error);
  }
}

export async function finalizeSound(rawMetadata: unknown, rawUpload: unknown): Promise<ActionResult<FinalizedReference>> {
  const { user } = await requireAdmin("/admin/references/new");
  const upload = uploadedFileSchema.safeParse(rawUpload);
  // Only files at the kind of path prepareSoundUpload hands out are ever touched.
  if (!upload.success || !/^sounds\/[a-z0-9-]+\/[0-9a-f-]{36}\.wav$/.test(upload.data.storagePath)) {
    return { ok: false, message: "The upload details were invalid." };
  }
  const client = await createServerSupabase();
  const metadata = referenceMetadataSchema.safeParse(rawMetadata);
  const category = metadata.success ? (await listCategories(client)).find((c) => c.id === metadata.data.categoryId) : undefined;
  if (!metadata.success || !category || !upload.data.storagePath.startsWith(`sounds/${category.slug}/`)) {
    await discardUpload(client, upload.data.storagePath);
    return { ok: false, message: "The reference details were invalid, so the upload was discarded." };
  }

  return finalizeUpload(client, user, {
    metadata: metadata.data,
    storagePath: upload.data.storagePath,
    originalFilename: upload.data.originalFilename,
    meta: { categorySlug: category.slug },
    sample: null,
  });
}

/** Best-effort removal of an uploaded file we won't use (logged if it fails). */
async function discardUpload(client: Awaited<ReturnType<typeof createServerSupabase>>, storagePath: string): Promise<void> {
  try {
    await removeReferenceFile(client, storagePath);
  } catch (error) {
    logServerError("discardUpload", error, { storagePath });
  }
}

// ---------------------------------------------------------------------------
// Instrument samples (bulk import, one file at a time)
// ---------------------------------------------------------------------------

export async function prepareSampleUpload(rawTarget: unknown): Promise<ActionResult<UploadTarget>> {
  await requireAdmin("/admin/import");
  const target = sampleTargetSchema.safeParse(rawTarget);
  if (!target.success) return { ok: false, message: target.error.issues[0]?.message ?? "Invalid sample." };
  try {
    const client = await createServerSupabase();
    const instrument = await findInstrument(target.data.instrumentId);
    if (!instrument) return { ok: false, message: "Unknown instrument." };
    const { midiNote, velocity, variant } = target.data;
    if (midiNote < instrument.midiMin || midiNote > instrument.midiMax) return { ok: false, message: `That note is outside the ${instrument.name.toLowerCase()}'s range.` };
    const existing = await existingSampleKeys(client, instrument.id, variant);
    if (existing.has(sampleKey(midiNote, velocity))) return { ok: false, message: "This note is already in the library.", code: "duplicate" };
    return { ok: true, value: await createUploadTarget(client, sampleStoragePath(instrument.slug, variant, midiNote, velocity)) };
  } catch (error) {
    // Storage refuses to sign a path that already holds a file.
    if (error instanceof Error && /exists|duplicate/i.test(String((error as { cause?: { message?: string } }).cause?.message ?? ""))) {
      return { ok: false, message: "A file for this note is already stored.", code: "duplicate" };
    }
    return failure("prepareSampleUpload", error);
  }
}

export async function finalizeSample(rawSettings: unknown, rawTarget: unknown, rawUpload: unknown): Promise<ActionResult<FinalizedReference>> {
  const { user } = await requireAdmin("/admin/import");
  const target = sampleTargetSchema.safeParse(rawTarget);
  const upload = uploadedFileSchema.safeParse(rawUpload);
  if (!target.success || !upload.success) return { ok: false, message: "The import details were invalid." };
  const client = await createServerSupabase();
  const instrument = await findInstrument(target.data.instrumentId);
  const { midiNote, velocity, variant } = target.data;
  // Only the exact path prepareSampleUpload hands out for this note is ever touched.
  if (!instrument || upload.data.storagePath !== sampleStoragePath(instrument.slug, variant, midiNote, velocity)) {
    return { ok: false, message: "The import details were invalid." };
  }
  const settings = importSettingsSchema.safeParse(rawSettings);
  if (!settings.success) {
    await discardUpload(client, upload.data.storagePath);
    return { ok: false, message: settings.error.issues[0]?.message ?? "The import settings were invalid." };
  }

  return finalizeUpload(client, user, {
    metadata: {
      name: sampleDisplayName(instrument.name, midiNote, variant, velocity),
      description: null,
      categoryId: instrument.categoryId,
      tags: [instrument.slug, variant],
      visibility: settings.data.visibility,
      license: settings.data.license,
      sourceUrl: settings.data.sourceUrl,
      attribution: settings.data.attribution,
      isSynthetic: false, // the importer is for real recordings only
    },
    storagePath: upload.data.storagePath,
    originalFilename: upload.data.originalFilename,
    meta: { categorySlug: "", instrumentSlug: instrument.slug, midiNote },
    sample: { instrumentId: instrument.id, variant, midiNote, velocity },
  });
}

// ---------------------------------------------------------------------------

async function finalizeUpload(
  client: Awaited<ReturnType<typeof createServerSupabase>>,
  user: SessionUser,
  input: {
    metadata: ReferenceMetadata;
    storagePath: string;
    originalFilename: string | null;
    meta: ReferenceMeta;
    sample: { instrumentId: string; variant: string; midiNote: number; velocity: number | null } | null;
  },
): Promise<ActionResult<FinalizedReference>> {
  let referenceId: string | null = null;
  try {
    // Re-validate the actual uploaded bytes: never trust what the browser said about them.
    const analysis = analyzeReferenceWav(await downloadReferenceFile(client, input.storagePath), input.meta);
    referenceId = await insertReference(client, {
      ...input.metadata,
      storagePath: input.storagePath,
      durationMs: Math.min(30_000, Math.max(1, Math.round(analysis.info.durationMs))),
      sampleRate: analysis.info.sampleRate,
      originalFilename: input.originalFilename,
      ownerId: user.id,
    });
    if (input.sample) await insertInstrumentSample(client, { referenceSoundId: referenceId, ...input.sample });
    await storeFeatures(client, referenceId, analysis);

    const pitch = analysis.features.find((f) => f.strategyId === "pitch") as PitchFeatures | undefined;
    const reading = pitch ? identifyNote(pitch) : null;
    revalidateAdmin();
    return {
      ok: true,
      value: {
        id: referenceId,
        durationMs: analysis.info.durationMs,
        detected: reading ? { name: reading.name, midi: reading.midi, cents: reading.cents } : null,
      },
    };
  } catch (error) {
    // Roll back so a failed import leaves nothing behind.
    try {
      if (referenceId) await deleteReference(client, referenceId);
      else await removeReferenceFile(client, input.storagePath);
    } catch (cleanupError) {
      logServerError("finalizeUpload cleanup", cleanupError, { storagePath: input.storagePath });
    }
    return failure("finalizeUpload", error, "The reference couldn't be saved. Please try again.");
  }
}

// ---------------------------------------------------------------------------
// Edit, delete, recompute
// ---------------------------------------------------------------------------

export async function updateReferenceAction(referenceId: string, _previous: MetadataFormState, formData: FormData): Promise<MetadataFormState> {
  await requireAdmin(`/admin/references/${referenceId}`);
  const parsed = referenceMetadataSchema.safeParse(metadataFromForm(formData));
  if (!parsed.success) return { status: "error", message: "Please fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  try {
    await updateReference(await createServerSupabase(), referenceId, parsed.data);
  } catch (error) {
    logServerError("updateReference", error, { referenceId });
    return { status: "error", message: "The changes couldn't be saved. Please try again." };
  }
  revalidateAdmin();
  return { status: "success", message: "Changes saved." };
}

export async function deleteReferenceAction(referenceId: string): Promise<ActionResult> {
  await requireAdmin("/admin/references");
  try {
    await deleteReference(await createServerSupabase(), referenceId);
  } catch (error) {
    return failure("deleteReference", error, "The reference couldn't be deleted. Please try again.");
  }
  revalidateAdmin();
  return { ok: true, value: undefined };
}

/**
 * Recomputes features for up to `limit` references whose features are
 * missing or from an older algorithm version. The admin page calls this in a
 * loop (small batches stay well inside serverless time limits).
 */
export async function recomputeFeaturesBatch(
  limit = 5,
  /** References that already failed in this run: skipped so the run can't get stuck on them. */
  skipIds: string[] = [],
): Promise<ActionResult<{ processed: number; failed: string[]; remaining: number }>> {
  await requireAdmin("/admin/references");
  try {
    const client = await createServerSupabase();
    const skip = new Set(skipIds);
    const outdated = (await listOutdatedReferenceIds(client)).filter((id) => !skip.has(id));
    let processed = 0;
    const failed: string[] = [];
    const batch = outdated.slice(0, Math.min(Math.max(limit, 1), 20));
    for (const id of batch) {
      try {
        await computeAndStoreFeatures(client, id);
        processed++;
      } catch (error) {
        failed.push(id);
        logServerError("recomputeFeatures", error, { referenceId: id });
      }
    }
    const remaining = outdated.length - batch.length;
    // Old-version features are only removed once everything is up to date.
    if (remaining === 0 && failed.length === 0 && skip.size === 0) await deleteStaleFeatures(client);
    return { ok: true, value: { processed, failed, remaining } };
  } catch (error) {
    return failure("recomputeFeaturesBatch", error);
  }
}

/** Notes already stored for an instrument variant (for duplicate checks and coverage in the importer). */
export async function loadExistingSamples(instrumentId: string, variant: string): Promise<ActionResult<{ keys: string[]; midi: number[] }>> {
  await requireAdmin("/admin/import");
  const target = sampleTargetSchema.pick({ instrumentId: true, variant: true }).safeParse({ instrumentId, variant });
  if (!target.success) return { ok: false, message: target.error.issues[0]?.message ?? "Invalid variant." };
  try {
    const keys = [...(await existingSampleKeys(await createServerSupabase(), target.data.instrumentId, target.data.variant))];
    return { ok: true, value: { keys, midi: [...new Set(keys.map((k) => Number(k.split(":")[0])))] } };
  } catch (error) {
    return failure("loadExistingSamples", error);
  }
}
