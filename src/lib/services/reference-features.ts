import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeReferenceWav, defaultRegistry, type ReferenceAnalysis, type ReferenceMeta } from "@/lib/audio-engine";
import type { Database, Json } from "@/lib/supabase/database.types";
import { ServiceError } from "./errors";
import { downloadReferenceFile, getReference } from "./references";

/**
 * Precomputed reference features. Extracted on the server (Node) from the
 * stored WAV with the same engine the browser uses, stored per
 * (reference, strategy, algorithm version), and recomputed when a strategy's
 * version changes.
 */

type Client = SupabaseClient<Database>;

export function referenceMeta(reference: { category: { slug: string }; sample: { instrumentSlug: string; midiNote: number } | null }): ReferenceMeta {
  return {
    categorySlug: reference.category.slug,
    instrumentSlug: reference.sample?.instrumentSlug ?? null,
    midiNote: reference.sample?.midiNote ?? null,
  };
}

/** Stores the features of one analysis (replacing any with the same strategy and version). */
export async function storeFeatures(client: Client, referenceSoundId: string, analysis: ReferenceAnalysis): Promise<void> {
  const rows = analysis.features.map((featureSet) => ({
    reference_sound_id: referenceSoundId,
    strategy_id: featureSet.strategyId,
    algorithm_version: featureSet.algorithmVersion,
    features: featureSet as unknown as Json,
    computed_at: new Date().toISOString(),
  }));
  const { error } = await client.from("reference_features").upsert(rows, { onConflict: "reference_sound_id,strategy_id,algorithm_version" });
  if (error) throw new ServiceError("Could not save reference features", error);
}

/** Downloads a reference's file, analyses it and stores its features. */
export async function computeAndStoreFeatures(client: Client, referenceSoundId: string): Promise<ReferenceAnalysis> {
  const reference = await getReference(client, referenceSoundId);
  if (!reference) throw new ServiceError("Reference not found or not permitted");
  const bytes = await downloadReferenceFile(client, reference.storagePath);
  const analysis = analyzeReferenceWav(bytes, referenceMeta(reference));
  await storeFeatures(client, referenceSoundId, analysis);
  return analysis;
}

/**
 * References that lack features from the CURRENT version of a strategy that
 * applies to them. Computed in JavaScript: fine for libraries of a few
 * thousand references.
 */
export async function listOutdatedReferenceIds(client: Client): Promise<string[]> {
  const { data, error } = await client
    .from("reference_sounds")
    .select("id, reference_categories(slug), instrument_samples(midi_note, instruments(slug)), reference_features(strategy_id, algorithm_version)")
    .order("created_at");
  if (error) throw new ServiceError("Could not check reference features", error);

  type Row = {
    id: string;
    reference_categories: { slug: string } | null;
    instrument_samples: { midi_note: number; instruments: { slug: string } | null } | Array<{ midi_note: number; instruments: { slug: string } | null }> | null;
    reference_features: Array<{ strategy_id: string; algorithm_version: string }>;
  };
  return (data as unknown as Row[])
    .filter((row) => {
      const sample = Array.isArray(row.instrument_samples) ? row.instrument_samples[0] : row.instrument_samples;
      const meta: ReferenceMeta = {
        categorySlug: row.reference_categories?.slug ?? "",
        instrumentSlug: sample?.instruments?.slug ?? null,
        midiNote: sample?.midi_note ?? null,
      };
      const have = new Set(row.reference_features.map((f) => `${f.strategy_id}@${f.algorithm_version}`));
      return defaultRegistry
        .list()
        .filter((strategy) => strategy.appliesTo(meta))
        .some((strategy) => !have.has(`${strategy.id}@${strategy.version}`));
    })
    .map((row) => row.id);
}

/** Removes features whose algorithm version is no longer current (after a successful recompute). */
export async function deleteStaleFeatures(client: Client): Promise<void> {
  for (const strategy of defaultRegistry.list()) {
    const { error } = await client.from("reference_features").delete().eq("strategy_id", strategy.id).neq("algorithm_version", strategy.version);
    if (error) throw new ServiceError("Could not remove outdated features", error);
  }
}

/** The stored features of one reference for one strategy's CURRENT version, or null if not computed yet. */
export async function getCurrentFeatures(client: Client, referenceSoundId: string, strategyId: string): Promise<unknown | null> {
  const strategy = defaultRegistry.get(strategyId);
  if (!strategy) return null;
  const { data, error } = await client
    .from("reference_features")
    .select("features")
    .eq("reference_sound_id", referenceSoundId)
    .eq("strategy_id", strategy.id)
    .eq("algorithm_version", strategy.version)
    .maybeSingle();
  if (error) throw new ServiceError("Could not load reference features", error);
  return data?.features ?? null;
}

export type InstrumentCandidate = {
  referenceId: string;
  name: string;
  variant: string;
  midiNote: number;
  noteName: string;
  velocity: number | null;
  isSynthetic: boolean;
  /** Current-version features by strategy id (pitch and timbre for notes). */
  features: Record<string, unknown>;
};

/** Every sample of an instrument (optionally one variant) with its current features. RLS hides private ones. */
export async function listInstrumentCandidates(client: Client, instrumentId: string, variant: string | null): Promise<InstrumentCandidate[]> {
  let query = client
    .from("instrument_samples")
    .select("reference_sound_id, variant, midi_note, note_name, velocity, reference_sounds!inner(name, is_synthetic, reference_features(strategy_id, algorithm_version, features))")
    .eq("instrument_id", instrumentId)
    .order("midi_note");
  if (variant) query = query.eq("variant", variant);
  const { data, error } = await query;
  if (error) throw new ServiceError("Could not load instrument samples", error);

  type Row = {
    reference_sound_id: string;
    variant: string;
    midi_note: number;
    note_name: string;
    velocity: number | null;
    reference_sounds: {
      name: string;
      is_synthetic: boolean;
      reference_features: Array<{ strategy_id: string; algorithm_version: string; features: unknown }>;
    } | null;
  };
  return (data as unknown as Row[]).flatMap((row) => {
    if (!row.reference_sounds) return [];
    const features: Record<string, unknown> = {};
    for (const f of row.reference_sounds.reference_features) {
      if (defaultRegistry.isCurrent(f.strategy_id, f.algorithm_version)) features[f.strategy_id] = f.features;
    }
    return [
      {
        referenceId: row.reference_sound_id,
        name: row.reference_sounds.name,
        variant: row.variant,
        midiNote: row.midi_note,
        noteName: row.note_name,
        velocity: row.velocity,
        isSynthetic: row.reference_sounds.is_synthetic,
        features,
      },
    ];
  });
}
