/**
 * Shapes returned by the features API routes (shared by server and browser).
 * They carry analysis features only; never audio.
 */
import type { FeatureSet } from "@/lib/audio-engine/types";

export type ReferenceSummary = {
  id: string;
  name: string;
  categoryName: string;
  noteName: string | null;
  velocity: number | null;
  variant: string | null;
  isSynthetic: boolean;
  durationMs: number;
};

export type ReferenceFeaturesResponse = {
  reference: ReferenceSummary;
  strategyId: string;
  features: FeatureSet;
};

export type InstrumentCandidateData = {
  referenceId: string;
  name: string;
  noteName: string;
  midiNote: number;
  velocity: number | null;
  variant: string;
  isSynthetic: boolean;
  pitch?: FeatureSet;
  timbre?: FeatureSet;
};

export type InstrumentFeaturesResponse = {
  instrument: { id: string; slug: string; name: string };
  variants: string[];
  variant: string | null;
  primary: "pitch" | "timbre";
  candidates: InstrumentCandidateData[];
};

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
