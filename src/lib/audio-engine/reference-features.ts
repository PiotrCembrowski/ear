/**
 * Feature extraction for reference sounds (run in Node when an admin imports
 * a reference, and by the recompute script).
 *
 * References go through the same sound-event detector as live input, so both
 * sides are "one sound event, at most 5 s": the reference's own leading
 * silence or long tail doesn't count against the user.
 */
import { MAX_EVENT_MS } from "./constants";
import { detectEvents, type DetectedEvent } from "./event-detector";
import { amplitudeToDb } from "./math";
import type { AudioClip, ComparisonStrategy, FeatureSet } from "./types";

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
