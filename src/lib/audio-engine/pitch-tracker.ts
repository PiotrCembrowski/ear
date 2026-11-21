/**
 * Streaming fundamental-frequency (f0) tracker using the McLeod Pitch Method
 * (MPM, via the `pitchy` library) at the analysis sample rate.
 *
 * MPM in one paragraph: for each candidate period τ it measures how similar
 * the waveform is to itself shifted by τ (the "normalized square difference
 * function", NSDF, between −1 and 1). A periodic sound has NSDF peaks at its
 * period and multiples of it. MPM picks the FIRST peak that is at least 90%
 * as high as the highest one (this avoids choosing a multiple of the period,
 * i.e. an octave-too-low error) and refines it between samples with a
 * parabola. The peak height is the "clarity": ~1 for a clean tone, low for
 * noise.
 *
 * High notes: above ~1 kHz a period is only a few samples long at 22,050 Hz,
 * so interpolating a single period is coarse (C8 would read ~8 cents off).
 * We therefore re-measure the lag of k periods (the NSDF also peaks at k·τ)
 * and divide by k, which shrinks the interpolation error by about k.
 *
 * Windows: every hop (512 samples ≈ 23 ms) we analyse the latest 2048 samples
 * (≈ 93 ms: responsive, covers ≥ 2 periods down to ~22 Hz). For low notes
 * (< 120 Hz) or unclear results we also try the latest 4096 samples
 * (≈ 186 ms), which holds more periods of a low fundamental and is steadier.
 */
import { PitchDetector } from "pitchy";
import { ANALYSIS_SAMPLE_RATE } from "./constants";
import { rmsDb } from "./features";

export type PitchFrame = {
  /** Centre of the analysis segment, ms since the tracker started. */
  timeMs: number;
  /** Detected f0, or 0 when no pitch was found. */
  hz: number;
  /** MPM clarity 0..1 (0 when no pitch). */
  clarity: number;
  /** RMS level of the analysed segment, dBFS. */
  levelDb: number;
};

export const PITCH_HOP = 512;
const SHORT_WINDOW = 2048;
const LONG_WINDOW = 4096;
/** Below this, prefer the long segment: a 2048 segment holds few periods of a low note. */
const LOW_NOTE_HZ = 120;
/** Below this clarity, the long segment gets a chance to do better. */
const RETRY_CLARITY = 0.9;
/** Below this level the frame is treated as silence (no pitch). */
const MIN_LEVEL_DB = -70;
/** Plausible musical range: a little below A0 (27.5 Hz) to a little above C8 (4186 Hz). */
const MIN_HZ = 25;
const MAX_HZ = 4500;

export class PitchTracker {
  private readonly sampleRate: number;
  private readonly buffer = new Float64Array(LONG_WINDOW);
  private filled = 0;
  private sinceHop = 0;
  private total = 0;
  private readonly shortDetector = PitchDetector.forFloat64Array(SHORT_WINDOW);
  private readonly longDetector = PitchDetector.forFloat64Array(LONG_WINDOW);
  private readonly shortView = new Float64Array(SHORT_WINDOW);

  constructor(sampleRate: number = ANALYSIS_SAMPLE_RATE) {
    this.sampleRate = sampleRate;
  }

  /** Adds analysis-rate samples; calls onFrame after every hop once 2048 samples exist. */
  push(samples: ArrayLike<number>, onFrame: (frame: PitchFrame) => void): void {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(PITCH_HOP - this.sinceHop, samples.length - offset);
      // Keep only the latest LONG_WINDOW samples (shift out the oldest).
      if (this.filled + take > LONG_WINDOW) {
        const shift = this.filled + take - LONG_WINDOW;
        this.buffer.copyWithin(0, shift, this.filled);
        this.filled -= shift;
      }
      for (let i = 0; i < take; i++) this.buffer[this.filled + i] = samples[offset + i]!;
      this.filled += take;
      offset += take;
      this.sinceHop += take;
      this.total += take;
      if (this.sinceHop === PITCH_HOP) {
        this.sinceHop = 0;
        if (this.filled >= SHORT_WINDOW) onFrame(this.analyze());
      }
    }
  }

  reset(): void {
    this.filled = 0;
    this.sinceHop = 0;
    this.total = 0;
  }

  private analyze(): PitchFrame {
    this.shortView.set(this.buffer.subarray(this.filled - SHORT_WINDOW, this.filled));
    const levelDb = rmsDb(this.shortView);
    const timeMs = ((this.total - SHORT_WINDOW / 2) / this.sampleRate) * 1000;
    if (levelDb < MIN_LEVEL_DB) return { timeMs, hz: 0, clarity: 0, levelDb };

    let [hz, clarity] = this.shortDetector.findPitch(this.shortView, this.sampleRate);
    if (this.filled >= LONG_WINDOW && (clarity < RETRY_CLARITY || hz < LOW_NOTE_HZ)) {
      const [longHz, longClarity] = this.longDetector.findPitch(this.buffer, this.sampleRate);
      // Prefer the long window when it is about as clear (it is steadier and
      // less prone to octave-up errors on low notes).
      if (longHz > 0 && longClarity >= clarity - 0.02) {
        hz = longHz;
        clarity = longClarity;
      }
    }
    if (!(hz >= MIN_HZ && hz <= MAX_HZ) || !Number.isFinite(clarity)) return { timeMs, hz: 0, clarity: 0, levelDb };
    return { timeMs, hz: refineWithMultiplePeriods(this.shortView, this.sampleRate, hz), clarity, levelDb };
  }
}

/** Time-domain NSDF at one integer lag: 2·Σ x[i]x[i+τ] / Σ (x[i]² + x[i+τ]²). */
function nsdfAt(segment: Float64Array, lag: number): number {
  let cross = 0;
  let energy = 0;
  for (let i = 0; i + lag < segment.length; i++) {
    const a = segment[i]!;
    const b = segment[i + lag]!;
    cross += a * b;
    energy += a * a + b * b;
  }
  return energy > 0 ? (2 * cross) / energy : 0;
}

/** Only refine when the single-period lag is short enough for interpolation error to matter. */
const REFINE_MAX_PERIOD_SAMPLES = 40;
/** Use at most half the segment, so the overlapping part stays large. */
const REFINE_MAX_LAG_FRACTION = 0.5;
/** Accept the refined value only if it stays this close (cents) to the MPM estimate. */
const REFINE_MAX_CHANGE_CENTS = 30;

/** Finds the NSDF peak near `expectedLag` (±1 sample) and refines it with a parabola. */
function peakLagNear(segment: Float64Array, expectedLag: number): { lag: number; value: number } | null {
  let bestLag = Math.round(expectedLag);
  let best = -Infinity;
  for (let lag = Math.floor(expectedLag) - 1; lag <= Math.ceil(expectedLag) + 1; lag++) {
    if (lag < 1 || lag >= segment.length) continue;
    const value = nsdfAt(segment, lag);
    if (value > best) {
      best = value;
      bestLag = lag;
    }
  }
  if (best < 0.5) return null;
  const left = nsdfAt(segment, bestLag - 1);
  const right = nsdfAt(segment, bestLag + 1);
  const denominator = left - 2 * best + right;
  const offset = denominator < 0 ? (0.5 * (left - right)) / denominator : 0;
  return { lag: bestLag + offset, value: best };
}

/**
 * Re-measures f0 from NSDF peaks at k periods and returns k · sampleRate / lag.
 * k grows in steps (4, 16, 64, …) so each step starts from a period estimate
 * accurate enough to find the next, larger multiple within ±1 sample.
 * Falls back to the original estimate if a peak is unclear or it moves too far.
 */
export function refineWithMultiplePeriods(segment: Float64Array, sampleRate: number, hz: number): number {
  let period = sampleRate / hz;
  if (period > REFINE_MAX_PERIOD_SAMPLES) return hz;
  const maxLag = segment.length * REFINE_MAX_LAG_FRACTION;
  for (let k = 4; k * period <= maxLag; k *= 4) {
    const peak = peakLagNear(segment, k * period);
    if (!peak) break;
    period = peak.lag / k;
  }
  const refined = sampleRate / period;
  return Math.abs(1200 * Math.log2(refined / hz)) <= REFINE_MAX_CHANGE_CENTS ? refined : hz;
}
