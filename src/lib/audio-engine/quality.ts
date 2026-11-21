/**
 * Quality warnings: plain-language notes about why a result may be
 * unreliable. They never change the score; they explain it.
 */
import { MIN_EVENT_MS, MAX_EVENT_MS } from "./constants";
import type { EventStats } from "./level-stats";
import type { QualityWarning, QualityWarningCode } from "./types";

/** Below this RMS level a sound is too quiet to measure reliably. */
export const TOO_QUIET_DB = -45;
/** More than 0.1% of samples at full scale means the input was clipping (distorted). */
export const CLIPPING_FRACTION = 0.001;
/** Sound should be at least this far above the background noise. */
export const MIN_SNR_DB = 15;

const MESSAGES: Record<QualityWarningCode, string> = {
  too_quiet: "The sound was very quiet. Move closer to the microphone or play louder.",
  clipping: "The sound was too loud and distorted. Move back a little or play softer.",
  too_short: "The sound was very short, so there was little to measure.",
  truncated: "The sound lasted longer than 5 seconds; only the first 5 seconds were analysed.",
  background_noise: "There was a lot of background noise compared with the sound.",
  no_clear_pitch: "No clear musical pitch was detected. This works best with a single sustained note.",
  multiple_notes: "More than one note was detected. Play one note at a time for a clearer result.",
  unstable_pitch: "The pitch wavered noticeably during the note.",
  octave_error: "The note seems to be in a different octave from the reference.",
};

export function warning(code: QualityWarningCode): QualityWarning {
  return { code, message: MESSAGES[code] };
}

/** Warnings that follow from loudness statistics alone. */
export function levelWarnings(stats: EventStats): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (stats.rmsDb < TOO_QUIET_DB) warnings.push(warning("too_quiet"));
  if (stats.clippedFraction > CLIPPING_FRACTION) warnings.push(warning("clipping"));
  if (stats.durationMs < MIN_EVENT_MS) warnings.push(warning("too_short"));
  if (stats.durationMs >= MAX_EVENT_MS) warnings.push(warning("truncated"));
  return warnings;
}

/** Background-noise warning, given the detector's noise floor while the sound played. */
export function noiseWarning(stats: EventStats, noiseFloorDb: number): QualityWarning[] {
  return stats.rmsDb - noiseFloorDb < MIN_SNR_DB ? [warning("background_noise")] : [];
}

/** Merges warning lists, keeping the first of each code. */
export function uniqueWarnings(...lists: QualityWarning[][]): QualityWarning[] {
  const seen = new Set<QualityWarningCode>();
  const out: QualityWarning[] = [];
  for (const w of lists.flat()) {
    if (!seen.has(w.code)) {
      seen.add(w.code);
      out.push(w);
    }
  }
  return out;
}
