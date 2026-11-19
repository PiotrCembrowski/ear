/**
 * App-wide constants that are not secrets and do not vary per environment.
 *
 * Anything here may be imported from both server and browser code. Values that
 * depend on the deployment (URLs, keys, limits you may want to tune per
 * environment) live in `public-env.ts` / `server-env.ts` instead.
 *
 * Audio-analysis constants (analysis sample rate, event length caps, window
 * sizes) live inside `src/lib/audio-engine/` because the engine must not import
 * app code.
 */
export const APP_NAME = "SoundMatch";

/** Concert pitch. Users can choose a different A4 in Settings within this range. */
export const A4 = {
  defaultHz: 440,
  minHz: 400,
  maxHz: 480,
} as const;

/**
 * Noise-gate sensitivity: how many decibels above the measured background noise
 * a sound must rise before it counts as a "sound event". Lower = more sensitive.
 */
export const SENSITIVITY_DB = {
  default: 12,
  min: 6,
  max: 30,
} as const;

/** Limits for reference sounds imported by admins (also enforced in the DB and Storage). */
export const REFERENCE_LIMITS = {
  maxDurationMs: 30_000,
  /** Stored references are normalized to mono 16-bit WAV at this rate for previews. */
  storedSampleRate: 44_100,
  /** 30 s × 44,100 Hz × 2 bytes ≈ 2.6 MB, so 5 MB leaves headroom. Matches the bucket limit. */
  maxStoredBytes: 5 * 1024 * 1024,
  /** Original files dropped into the importer are decoded in the browser, never uploaded. */
  maxImportFileBytes: 50 * 1024 * 1024,
} as const;

/** Name of the only Storage bucket. There is deliberately no bucket for user audio. */
export const REFERENCES_BUCKET = "references";

/** Upper bound for a stored comparison summary (also a CHECK constraint in the DB). */
export const COMPARISON_RESULT_MAX_BYTES = 16 * 1024;

/** Default per-user limit for history writes; override with env vars (see server-env.ts). */
export const HISTORY_RATE_LIMIT_DEFAULTS = {
  max: 120,
  windowSeconds: 600,
} as const;
