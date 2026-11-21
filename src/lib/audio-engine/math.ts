/** Small numeric helpers shared by the engine. Pure functions, no allocation surprises. */

import { SILENCE_DB } from "./constants";

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Amplitude (0..1 full scale) → decibels relative to full scale (dBFS). */
export function amplitudeToDb(amplitude: number): number {
  return amplitude > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(amplitude)) : SILENCE_DB;
}

export function dbToAmplitude(db: number): number {
  return 10 ** (db / 20);
}

/** Interval between two frequencies in cents (100 cents = 1 equal-tempered semitone). */
export function centsBetween(hz: number, referenceHz: number): number {
  return 1200 * Math.log2(hz / referenceHz);
}

/** Median of a list (copy-sorts; does not modify the input). NaN for an empty list. */
export function median(values: ArrayLike<number>): number {
  return percentile(values, 50);
}

/** Linear-interpolated percentile (0..100). NaN for an empty list. */
export function percentile(values: ArrayLike<number>, p: number): number {
  const n = values.length;
  if (n === 0) return Number.NaN;
  const sorted = Array.from(values).sort((a, b) => a - b);
  const position = (clamp(p, 0, 100) / 100) * (n - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return Number.NaN;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  return sum / values.length;
}

export function standardDeviation(values: ArrayLike<number>): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += (values[i]! - m) ** 2;
  return Math.sqrt(sum / (values.length - 1));
}

/**
 * Rounds to a fixed number of decimals. Used before features are stored, so
 * JSON stays compact and the stored numbers are exactly what was compared.
 */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Resamples a series to `count` points by linear interpolation (for compact visuals). */
export function resampleSeries(values: ArrayLike<number>, count: number): number[] {
  const n = values.length;
  if (n === 0 || count <= 0) return [];
  if (n === 1) return new Array<number>(count).fill(values[0]!);
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    const position = count === 1 ? 0 : (i * (n - 1)) / (count - 1);
    const lower = Math.floor(position);
    const upper = Math.min(n - 1, lower + 1);
    const weight = position - lower;
    out[i] = values[lower]! * (1 - weight) + values[upper]! * weight;
  }
  return out;
}
