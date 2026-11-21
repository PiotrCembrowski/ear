/**
 * Core types of the audio engine. Plain TypeScript: no React, Next.js,
 * Supabase or browser APIs, so the same code runs in a Web Worker (live
 * analysis) and in Node (reference features, tests).
 */

/** Mono audio in memory. Samples are floats in [-1, 1]. */
export type AudioClip = {
  samples: Float32Array;
  sampleRate: number;
};

/** What the registry needs to know about a reference to pick a strategy. */
export type ReferenceMeta = {
  categorySlug: string;
  instrumentSlug?: string | null;
  /** Set for instrument note samples (e.g. 69 for a piano A4). */
  midiNote?: number | null;
};

/** Features produced by one strategy, stored as JSON with its id and version. */
export type FeatureSet<TData = unknown> = {
  strategyId: string;
  algorithmVersion: string;
  data: TData;
};

export type QualityWarningCode =
  | "too_quiet"
  | "clipping"
  | "too_short"
  | "truncated"
  | "background_noise"
  | "no_clear_pitch"
  | "multiple_notes"
  | "unstable_pitch"
  | "octave_error";

export type QualityWarning = {
  code: QualityWarningCode;
  /** One plain-language sentence the UI can show as-is. */
  message: string;
};

/** One line of the score breakdown. `weight` 0 = shown for context, not part of the score. */
export type BreakdownItem = {
  id: string;
  label: string;
  /** 0–100 */
  score: number;
  weight: number;
  /** What was measured, in words, e.g. "+7 cents from the reference". */
  detail: string;
};

/** A measured property of the input sound, for the "detected characteristics" list. */
export type Characteristic = {
  id: "pitch" | "note" | "duration" | "loudness" | "peak" | "brightness" | "stability";
  label: string;
  value: number;
  unit: string;
  /** Ready-to-show text, e.g. "A4, +7 cents" or "1.2 s". */
  display: string;
};

/** Compact data for result visuals (downsampled; never audio). */
export type ResultVisuals = {
  /** Pitch over time of the input, in cents relative to the reference (pitch strategy). */
  pitchTrack?: { timeMs: number[]; cents: number[] };
  /** Average spectrum on a mel scale, input vs reference, in dB relative to each one's maximum. */
  spectrum?: { bandHz: number[]; inputDb: number[]; referenceDb: number[] };
  /** Loudness envelope over normalized time (0..1), input vs reference, dB relative to peak. */
  envelope?: { inputDb: number[]; referenceDb: number[] };
};

export type ComparisonResult = {
  strategyId: string;
  algorithmVersion: string;
  /** Heuristic similarity, 0–100. Not a validated measurement. */
  score: number;
  /** One or two sentences: what was compared and how the score was formed. */
  explanation: string;
  breakdown: BreakdownItem[];
  characteristics: Characteristic[];
  warnings: QualityWarning[];
  visuals: ResultVisuals;
};

export type CompareContext = {
  /** Concert pitch for naming notes (user setting). Default 440. */
  a4Hz?: number;
};

/** Cheap, frequently-updated reading for live UI (level meter, tuner needle). */
export type LiveReading = {
  /** RMS level of the most recent audio, dBFS. */
  levelDb: number;
  /** Latest pitch estimate, or null when there is no clear pitch. */
  pitch: { hz: number; clarity: number } | null;
  /** Length of audio pushed since the last reset, ms. */
  elapsedMs: number;
};

/**
 * Streaming analyzer for ONE sound event. Accepts audio at the device's
 * sample rate in blocks of any size, keeps only derived features (never the
 * raw audio beyond its small internal frame buffers), and produces a
 * FeatureSet when the event ends.
 *
 * For the same audio, push()+finish() must give exactly the same features as
 * the strategy's batch extract(), whatever the block size (tested).
 */
export interface LiveAnalyzer<TData = unknown> {
  readonly inputSampleRate: number;
  push(block: Float32Array): void;
  snapshot(): LiveReading;
  finish(): FeatureSet<TData>;
  reset(): void;
  /**
   * Optional: true once enough of the sound has been heard for a reliable
   * result, so the app can show it without waiting for the sound to end
   * (a piano note can ring for 5 s; its pitch is clear after ~0.6 s).
   */
  readyToFinish?(): boolean;
}

export interface ComparisonStrategy<TData = unknown> {
  /** Stable id, stored with features and results, e.g. "pitch". */
  readonly id: string;
  /** Bump when the algorithm changes; stored features with another version are recomputed. */
  readonly version: string;
  /** Short name for the UI. */
  readonly label: string;
  appliesTo(reference: ReferenceMeta): boolean;
  createAnalyzer(sampleRate: number): LiveAnalyzer<TData>;
  extract(clip: AudioClip): FeatureSet<TData>;
  compare(input: FeatureSet<TData>, reference: FeatureSet<TData>, context?: CompareContext): ComparisonResult;
  /** Validates features loaded from storage or the network. Throws on bad data. */
  parseFeatures(value: unknown): FeatureSet<TData>;
}
