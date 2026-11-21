import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { REFERENCES_BUCKET } from "@/lib/config/app-config";
import type { Database, ReferenceVisibility } from "@/lib/supabase/database.types";
import { ServiceError } from "./errors";

/**
 * Reference sounds: categories, instruments, the library listing, and admin
 * writes. Every function takes the Supabase client to use:
 *   - pages and Server Actions pass the signed-in user's client, so Row Level
 *     Security applies (only admins can write; private references stay hidden);
 *   - scripts pass a secret-key client.
 */

type Client = SupabaseClient<Database>;

export type Category = { id: string; slug: string; name: string };
export type Instrument = { id: string; slug: string; name: string; categoryId: string; midiMin: number; midiMax: number; expectedNoteCount: number };

export type ReferenceSample = {
  instrumentId: string;
  instrumentSlug: string;
  instrumentName: string;
  variant: string;
  midiNote: number;
  noteName: string;
  velocity: number | null;
};

export type ReferenceListItem = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  durationMs: number;
  sampleRate: number;
  visibility: ReferenceVisibility;
  isSynthetic: boolean;
  license: string;
  sourceUrl: string | null;
  attribution: string | null;
  storagePath: string;
  createdAt: string;
  category: { id: string; slug: string; name: string };
  sample: ReferenceSample | null;
};

export async function listCategories(client: Client): Promise<Category[]> {
  const { data, error } = await client.from("reference_categories").select("id, slug, name").order("sort_order");
  if (error) throw new ServiceError("Could not load categories", error);
  return data;
}

export async function listInstruments(client: Client): Promise<Instrument[]> {
  const { data, error } = await client
    .from("instruments")
    .select("id, slug, name, category_id, midi_min, midi_max, expected_note_count")
    .order("name");
  if (error) throw new ServiceError("Could not load instruments", error);
  return data.map((i) => ({
    id: i.id,
    slug: i.slug,
    name: i.name,
    categoryId: i.category_id,
    midiMin: i.midi_min,
    midiMax: i.midi_max,
    expectedNoteCount: i.expected_note_count,
  }));
}

const REFERENCE_COLUMNS =
  "id, name, description, tags, duration_ms, sample_rate, visibility, is_synthetic, license, source_url, attribution, storage_path, created_at, " +
  "reference_categories(id, slug, name), instrument_samples(instrument_id, variant, midi_note, note_name, velocity, instruments(slug, name))";

type ReferenceRow = {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  duration_ms: number;
  sample_rate: number;
  visibility: ReferenceVisibility;
  is_synthetic: boolean;
  license: string;
  source_url: string | null;
  attribution: string | null;
  storage_path: string;
  created_at: string;
  reference_categories: { id: string; slug: string; name: string } | null;
  instrument_samples:
    | {
        instrument_id: string;
        variant: string;
        midi_note: number;
        note_name: string;
        velocity: number | null;
        instruments: { slug: string; name: string } | null;
      }
    | Array<{
        instrument_id: string;
        variant: string;
        midi_note: number;
        note_name: string;
        velocity: number | null;
        instruments: { slug: string; name: string } | null;
      }>
    | null;
};

function toListItem(row: ReferenceRow): ReferenceListItem {
  // PostgREST returns a one-to-one embed as an object; be tolerant of arrays too.
  const sample = Array.isArray(row.instrument_samples) ? (row.instrument_samples[0] ?? null) : row.instrument_samples;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tags: row.tags,
    durationMs: row.duration_ms,
    sampleRate: row.sample_rate,
    visibility: row.visibility,
    isSynthetic: row.is_synthetic,
    license: row.license,
    sourceUrl: row.source_url,
    attribution: row.attribution,
    storagePath: row.storage_path,
    createdAt: row.created_at,
    category: row.reference_categories ?? { id: "", slug: "", name: "Uncategorised" },
    sample: sample
      ? {
          instrumentId: sample.instrument_id,
          instrumentSlug: sample.instruments?.slug ?? "",
          instrumentName: sample.instruments?.name ?? "",
          variant: sample.variant,
          midiNote: sample.midi_note,
          noteName: sample.note_name,
          velocity: sample.velocity,
        }
      : null,
  };
}

/**
 * Makes free text safe to embed in a PostgREST filter: keeps letters, digits,
 * spaces, '#' and '-' (note names), trims and limits length. Characters like
 * , ( ) * % that have meaning in PostgREST filters are removed.
 */
export function sanitizeSearchText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s#-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export type ReferenceSearch = {
  query?: string;
  categoryId?: string;
  instrumentId?: string;
  page?: number;
  pageSize?: number;
};

export type ReferencePage = { items: ReferenceListItem[]; total: number; page: number; pageSize: number };

export async function searchReferences(client: Client, search: ReferenceSearch): Promise<ReferencePage> {
  const pageSize = Math.min(Math.max(search.pageSize ?? 24, 1), 100);
  const page = Math.max(search.page ?? 1, 1);
  // `!inner` turns the embed into a filter: only references that ARE samples of that instrument.
  const columns = search.instrumentId ? REFERENCE_COLUMNS.replace("instrument_samples(", "instrument_samples!inner(") : REFERENCE_COLUMNS;
  let query = client.from("reference_sounds").select(columns, { count: "exact" });

  if (search.categoryId) query = query.eq("category_id", search.categoryId);
  if (search.instrumentId) query = query.eq("instrument_samples.instrument_id", search.instrumentId);
  const text = sanitizeSearchText(search.query ?? "");
  if (text) {
    // Name/description substring match, or a tag equal to a search word.
    const pattern = `*${text}*`; // PostgREST spells the LIKE wildcard `*`
    const words = text.toLowerCase().split(" ").filter(Boolean);
    query = query.or(`name.ilike.${pattern},description.ilike.${pattern},tags.ov.{${words.map((w) => `"${w}"`).join(",")}}`);
  }
  // Instrument samples sort by their storage path (variant, then zero-padded MIDI number).
  query = search.instrumentId ? query.order("storage_path") : query.order("created_at", { ascending: false });

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.range(from, from + pageSize - 1);
  if (error) throw new ServiceError("Could not search references", error);
  return { items: (data as unknown as ReferenceRow[]).map(toListItem), total: count ?? 0, page, pageSize };
}

export async function getReference(client: Client, id: string): Promise<ReferenceListItem | null> {
  const { data, error } = await client.from("reference_sounds").select(REFERENCE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new ServiceError("Could not load reference", error);
  return data ? toListItem(data as unknown as ReferenceRow) : null;
}

/** Short-lived playback URLs for private files (RLS decides which ones the caller may read). */
export async function signedAudioUrls(client: Client, paths: string[], expiresInSeconds = 3600): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (paths.length === 0) return urls;
  const { data, error } = await client.storage.from(REFERENCES_BUCKET).createSignedUrls(paths, expiresInSeconds);
  if (error) throw new ServiceError("Could not create playback links", error);
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Admin writes (RLS allows them only for admins)
// ---------------------------------------------------------------------------

export type ReferenceMetadata = {
  name: string;
  description: string | null;
  categoryId: string;
  tags: string[];
  visibility: ReferenceVisibility;
  license: string;
  sourceUrl: string | null;
  attribution: string | null;
  isSynthetic: boolean;
};

/** A signed URL the browser can upload one file to, without the file passing through our server. */
export async function createUploadTarget(client: Client, storagePath: string): Promise<{ path: string; token: string }> {
  const { data, error } = await client.storage.from(REFERENCES_BUCKET).createSignedUploadUrl(storagePath);
  if (error) throw new ServiceError("Could not prepare the upload", error);
  return { path: data.path, token: data.token };
}

export async function downloadReferenceFile(client: Client, storagePath: string): Promise<Uint8Array> {
  const { data, error } = await client.storage.from(REFERENCES_BUCKET).download(storagePath);
  if (error || !data) throw new ServiceError("Could not read the uploaded file", error);
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeReferenceFile(client: Client, storagePath: string): Promise<void> {
  const { error } = await client.storage.from(REFERENCES_BUCKET).remove([storagePath]);
  if (error) throw new ServiceError("Could not delete the file", error);
}

export async function insertReference(
  client: Client,
  input: ReferenceMetadata & { storagePath: string; durationMs: number; sampleRate: number; originalFilename: string | null; ownerId: string },
): Promise<string> {
  const { data, error } = await client
    .from("reference_sounds")
    .insert({
      name: input.name,
      description: input.description,
      category_id: input.categoryId,
      tags: input.tags,
      visibility: input.visibility,
      license: input.license,
      source_url: input.sourceUrl,
      attribution: input.attribution,
      is_synthetic: input.isSynthetic,
      storage_path: input.storagePath,
      duration_ms: input.durationMs,
      sample_rate: input.sampleRate,
      original_filename: input.originalFilename,
      owner_id: input.ownerId,
    })
    .select("id")
    .single();
  if (error) throw new ServiceError("Could not save the reference", error);
  return data.id;
}

export async function insertInstrumentSample(
  client: Client,
  input: { referenceSoundId: string; instrumentId: string; variant: string; midiNote: number; velocity: number | null },
): Promise<void> {
  const { error } = await client.from("instrument_samples").insert({
    reference_sound_id: input.referenceSoundId,
    instrument_id: input.instrumentId,
    variant: input.variant,
    midi_note: input.midiNote,
    velocity: input.velocity,
  });
  if (error) throw new ServiceError("Could not save the instrument sample", error);
}

export async function updateReference(client: Client, id: string, metadata: ReferenceMetadata): Promise<void> {
  const { data, error } = await client
    .from("reference_sounds")
    .update({
      name: metadata.name,
      description: metadata.description,
      category_id: metadata.categoryId,
      tags: metadata.tags,
      visibility: metadata.visibility,
      license: metadata.license,
      source_url: metadata.sourceUrl,
      attribution: metadata.attribution,
      is_synthetic: metadata.isSynthetic,
    })
    .eq("id", id)
    .select("id");
  if (error) throw new ServiceError("Could not update the reference", error);
  if (!data?.length) throw new ServiceError("Reference not found or not permitted");
}

/** Deletes the row (features and sample link cascade; history keeps its snapshot), then the file. */
export async function deleteReference(client: Client, id: string): Promise<void> {
  const { data, error } = await client.from("reference_sounds").delete().eq("id", id).select("storage_path");
  if (error) throw new ServiceError("Could not delete the reference", error);
  const path = data?.[0]?.storage_path;
  if (!path) throw new ServiceError("Reference not found or not permitted");
  await removeReferenceFile(client, path);
}

/** Notes already stored for an instrument variant, as "midi:velocity" keys (velocity "" when none). */
export async function existingSampleKeys(client: Client, instrumentId: string, variant: string): Promise<Set<string>> {
  const { data, error } = await client.from("instrument_samples").select("midi_note, velocity").eq("instrument_id", instrumentId).eq("variant", variant);
  if (error) throw new ServiceError("Could not load existing samples", error);
  return new Set(data.map((row) => sampleKey(row.midi_note, row.velocity)));
}

export function sampleKey(midi: number, velocity: number | null): string {
  return `${midi}:${velocity ?? ""}`;
}

/** Variants that already exist for an instrument (for the importer's suggestions). */
export async function listVariants(client: Client, instrumentId: string): Promise<string[]> {
  const { data, error } = await client.from("instrument_samples").select("variant").eq("instrument_id", instrumentId);
  if (error) throw new ServiceError("Could not load variants", error);
  return [...new Set(data.map((row) => row.variant))].sort();
}
