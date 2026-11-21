/**
 * Feature extraction for reference sounds (run in Node when an admin imports
 * a reference, and by the recompute script).
 *
 * References go through the same sound-event detector as live input, so both
 * sides are "one sound event, at most 5 s": the reference's own leading
 * silence or long tail doesn't count against the user.
 */
import { MAX_EVENT_MS } from "./constants";
import { defaultRegistry, type StrategyRegistry } from "./registry";
import { decodeWav, WavFormatError, type WavInfo } from "./wav";
import { detectEvents, type DetectedEvent } from "./event-detector";
import { amplitudeToDb } from "./math";
import type { AudioClip, ComparisonStrategy, FeatureSet, ReferenceMeta } from "./types";

/** Used when the detector finds no usable event. */
const FALLBACK_THRESHOLD_DB = -60;
/**
 * Silence added before detection. Sample-library files often start exactly
 * at the attack; without padding, the detector's 250 ms warm-up would treat
 * the start of the sound as "background" and cut off the attack.
 */
const DETECTION_PADDING_SECONDS = 0.3;

export type ReferenceEvent = {
  /** Where the event was found in the clip, ms. */
  startMs: number;
  durationMs: number;
  /** "detected" by the event detector, or "fallback" (trimmed by a fixed threshold). */
  method: "detected" | "fallback";
  clip: AudioClip;
};

/** The loudest sound event in a clip (references should contain one sound). */
export function mainEvent(clip: AudioClip): ReferenceEvent {
  const padding = Math.round(DETECTION_PADDING_SECONDS * clip.sampleRate);
  const padded = new Float32Array(padding + clip.samples.length);
  padded.set(clip.samples, padding);
  const events = detectEvents(padded, clip.sampleRate).filter((e) => !e.tooShort);
  if (events.length > 0) {
    const loudest = events.reduce((best, e) => (energy(e) > energy(best) ? e : best));
    // Drop any of the added silence that ended up in the event's pre-roll.
    const skip = Math.max(0, padding - loudest.audioStartSample);
    const samples = loudest.samples.slice(skip);
    return {
      startMs: (Math.max(0, loudest.onsetSample - padding) / clip.sampleRate) * 1000,
      durationMs: (samples.length / clip.sampleRate) * 1000,
      method: "detected",
      clip: { samples, sampleRate: clip.sampleRate },
    };
  }
  // Fallback: trim leading/trailing samples below −60 dBFS and cap at 5 s.
  const threshold = 10 ** (FALLBACK_THRESHOLD_DB / 20);
  let start = 0;
  while (start < clip.samples.length && Math.abs(clip.samples[start]!) < threshold) start++;
  let end = clip.samples.length;
  while (end > start && Math.abs(clip.samples[end - 1]!) < threshold) end--;
  end = Math.min(end, start + Math.round((MAX_EVENT_MS / 1000) * clip.sampleRate));
  const samples = clip.samples.slice(start, end);
  return {
    startMs: (start / clip.sampleRate) * 1000,
    durationMs: (samples.length / clip.sampleRate) * 1000,
    method: "fallback",
    clip: { samples, sampleRate: clip.sampleRate },
  };
}

function energy(event: DetectedEvent): number {
  let sum = 0;
  for (let i = 0; i < event.samples.length; i++) sum += event.samples[i]! ** 2;
  return sum;
}

export type ReferenceExtraction = {
  event: Omit<ReferenceEvent, "clip"> & { rmsDb: number };
  features: FeatureSet[];
};

/** Extracts features for each given strategy from the reference's main event. */
export function extractReferenceFeatures(clip: AudioClip, strategies: readonly ComparisonStrategy<unknown>[]): ReferenceExtraction {
  const event = mainEvent(clip);
  if (event.clip.samples.length === 0) throw new Error("The reference contains no sound above −60 dBFS.");
  let sum = 0;
  for (let i = 0; i < event.clip.samples.length; i++) sum += event.clip.samples[i]! ** 2;
  return {
    event: {
      startMs: event.startMs,
      durationMs: event.durationMs,
      method: event.method,
      rmsDb: amplitudeToDb(Math.sqrt(sum / event.clip.samples.length)),
    },
    features: strategies.map((strategy) => strategy.extract(event.clip)),
  };
}

/** Limits for stored reference WAVs (the importer normalizes to fit them). */
export const REFERENCE_AUDIO_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  /** 30 s, plus a little slack for rounding by encoders. */
  maxDurationMs: 30_100,
  minDurationMs: 50,
} as const;

export type ReferenceAudioErrorCode = "not-wav" | "too-large" | "too-long" | "too-short" | "silent";

export class ReferenceAudioError extends Error {
  constructor(
    readonly code: ReferenceAudioErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReferenceAudioError";
  }
}

export type ReferenceAnalysis = ReferenceExtraction & { info: WavInfo };

/**
 * Validates a stored reference WAV and extracts features for every strategy
 * that applies to it (instrument notes get both pitch and timbre: timbre is
 * the tie-break between velocity layers in closest-match). Runs in Node on
 * the server, and in the recompute script.
 */
export function analyzeReferenceWav(bytes: Uint8Array, meta: ReferenceMeta, registry: StrategyRegistry = defaultRegistry): ReferenceAnalysis {
  if (bytes.byteLength > REFERENCE_AUDIO_LIMITS.maxBytes) {
    throw new ReferenceAudioError("too-large", `The file is larger than ${REFERENCE_AUDIO_LIMITS.maxBytes / 1024 / 1024} MB.`);
  }
  let decoded: ReturnType<typeof decodeWav>;
  try {
    decoded = decodeWav(bytes);
  } catch (error) {
    if (error instanceof WavFormatError) throw new ReferenceAudioError("not-wav", error.message);
    throw error;
  }
  if (decoded.info.durationMs > REFERENCE_AUDIO_LIMITS.maxDurationMs) throw new ReferenceAudioError("too-long", "The sound is longer than 30 seconds.");
  if (decoded.info.durationMs < REFERENCE_AUDIO_LIMITS.minDurationMs) throw new ReferenceAudioError("too-short", "The sound is too short to analyse.");

  const strategies = registry.list().filter((strategy) => strategy.appliesTo(meta));
  try {
    return { info: decoded.info, ...extractReferenceFeatures(decoded, strategies) };
  } catch (error) {
    if (error instanceof Error && /no sound/.test(error.message)) throw new ReferenceAudioError("silent", "The file contains no audible sound.");
    throw error;
  }
}
