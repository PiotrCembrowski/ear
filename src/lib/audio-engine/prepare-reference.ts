/**
 * Prepares decoded audio for storage as a reference sound:
 *   1. downmix to mono (average of channels);
 *   2. trim leading/trailing silence below −70 dBFS, keeping a 20 ms margin
 *      (sample libraries often pad files; the margin keeps soft attacks);
 *   3. cap the length at 30 s (long piano decays are cut, with a note).
 *
 * Loudness is NOT normalized: in a sample library the level difference
 * between velocity layers is part of the information.
 */
import { amplitudeToDb } from "./math";
import type { AudioClip } from "./types";

export const REFERENCE_MAX_SECONDS = 30;
const TRIM_THRESHOLD_DB = -70;
const TRIM_MARGIN_SECONDS = 0.02;

export type PreparedReference = {
  clip: AudioClip;
  durationMs: number;
  /** Silence removed from the start, ms. */
  trimmedStartMs: number;
  /** True if the sound was longer than 30 s and was cut. */
  truncated: boolean;
  peakDb: number;
};

export function prepareReferenceAudio(channels: Float32Array[], sampleRate: number): PreparedReference {
  const length = channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i]! += channel[i]! / channels.length;

  const threshold = 10 ** (TRIM_THRESHOLD_DB / 20);
  let first = 0;
  while (first < length && Math.abs(mono[first]!) < threshold) first++;
  let last = length - 1;
  while (last > first && Math.abs(mono[last]!) < threshold) last--;
  const margin = Math.round(TRIM_MARGIN_SECONDS * sampleRate);
  const start = first >= length ? 0 : Math.max(0, first - margin);
  const end = first >= length ? 0 : Math.min(length, last + 1 + margin);

  const maxSamples = REFERENCE_MAX_SECONDS * sampleRate;
  const truncated = end - start > maxSamples;
  const samples = mono.slice(start, Math.min(end, start + maxSamples));
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]!));

  return {
    clip: { samples, sampleRate },
    durationMs: (samples.length / sampleRate) * 1000,
    trimmedStartMs: (start / sampleRate) * 1000,
    truncated,
    peakDb: amplitudeToDb(peak),
  };
}
