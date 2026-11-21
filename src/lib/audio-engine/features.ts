/**
 * Frame-level audio features, computed from a frame's samples or its
 * magnitude spectrum. These are the building blocks of the strategies.
 *
 * Units: frequencies in Hz, levels in dBFS (0 dB = full-scale sine peak).
 */
import { amplitudeToDb } from "./math";

/** Root-mean-square level of a frame (linear, 0..~1). */
export function rms(frame: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

export function rmsDb(frame: ArrayLike<number>): number {
  return amplitudeToDb(rms(frame));
}

/** Number of sign changes in the frame (high for noise and hiss, low for tones). */
export function zeroCrossings(frame: ArrayLike<number>): number {
  let count = 0;
  for (let i = 1; i < frame.length; i++) {
    if ((frame[i - 1]! >= 0) !== (frame[i]! >= 0)) count++;
  }
  return count;
}

/**
 * Spectral centroid: the weighted mean frequency, i.e. the spectrum's
 * "centre of mass". Perceptually close to brightness.
 *
 * `exponent` 1 weights bins by amplitude (the common definition, used by
 * Meyda); 2 weights by power, which makes the result far less sensitive to
 * low-level broadband noise (hundreds of faint noise bins add up in
 * amplitude, but barely at all in power). The timbre strategy uses power.
 */
export function spectralCentroid(magnitudes: ArrayLike<number>, sampleRate: number, fftSize: number, exponent: 1 | 2 = 1): number {
  let weighted = 0;
  let total = 0;
  for (let k = 0; k < magnitudes.length; k++) {
    const w = exponent === 2 ? magnitudes[k]! * magnitudes[k]! : magnitudes[k]!;
    weighted += k * w;
    total += w;
  }
  return total > 0 ? ((weighted / total) * sampleRate) / fftSize : 0;
}

/**
 * Spectral rolloff: the frequency below which `fraction` of the total
 * spectral amplitude (exponent 1) or power (exponent 2) lies (0.85 by
 * default). Higher = more high-frequency content (brighter, noisier).
 */
export function spectralRolloff(magnitudes: ArrayLike<number>, sampleRate: number, fftSize: number, fraction = 0.85, exponent: 1 | 2 = 1): number {
  const weight = (m: number) => (exponent === 2 ? m * m : m);
  let total = 0;
  for (let k = 0; k < magnitudes.length; k++) total += weight(magnitudes[k]!);
  if (total <= 0) return 0;
  const target = total * fraction;
  let cumulative = 0;
  for (let k = 0; k < magnitudes.length; k++) {
    cumulative += weight(magnitudes[k]!);
    if (cumulative >= target) return (k * sampleRate) / fftSize;
  }
  return sampleRate / 2;
}

// ---------------------------------------------------------------------------
// Mel filterbank and MFCC
// ---------------------------------------------------------------------------

/** HTK mel scale: roughly linear below 1 kHz and logarithmic above, like human pitch perception. */
export const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
export const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

export type MelFilterbank = {
  /** Centre frequency of each band, Hz. */
  centerHz: number[];
  /** For each band: first FFT bin and the triangular weights from there. */
  filters: Array<{ startBin: number; weights: Float64Array }>;
};

/**
 * `bandCount` overlapping triangular filters spaced evenly on the mel scale
 * between fMin and fMax. Each triangle rises from the previous band's centre
 * to its own centre (weight 1) and falls to the next band's centre. Weights
 * use exact bin frequencies (no rounding to bins), so narrow low bands still
 * get energy.
 */
export function createMelFilterbank(sampleRate: number, fftSize: number, bandCount: number, fMin: number, fMax: number): MelFilterbank {
  const melMin = hzToMel(fMin);
  const melMax = hzToMel(Math.min(fMax, sampleRate / 2));
  const edgesHz = Array.from({ length: bandCount + 2 }, (_, i) => melToHz(melMin + ((melMax - melMin) * i) / (bandCount + 1)));
  const binHz = sampleRate / fftSize;
  const binCount = fftSize / 2 + 1;
  const filters: MelFilterbank["filters"] = [];
  for (let b = 0; b < bandCount; b++) {
    const lower = edgesHz[b]!;
    const centre = edgesHz[b + 1]!;
    const upper = edgesHz[b + 2]!;
    const startBin = Math.max(0, Math.ceil(lower / binHz));
    const endBin = Math.min(binCount - 1, Math.floor(upper / binHz));
    const weights = new Float64Array(Math.max(0, endBin - startBin + 1));
    for (let k = startBin; k <= endBin; k++) {
      const f = k * binHz;
      weights[k - startBin] = f <= centre ? (f - lower) / (centre - lower) : (upper - f) / (upper - centre);
    }
    filters.push({ startBin, weights });
  }
  return { centerHz: edgesHz.slice(1, -1), filters };
}

/** Mel band energies (sum of weighted POWER, |X|²) into `out`. */
export function melEnergies(magnitudes: ArrayLike<number>, bank: MelFilterbank, out: Float64Array): Float64Array {
  for (let b = 0; b < bank.filters.length; b++) {
    const { startBin, weights } = bank.filters[b]!;
    let sum = 0;
    for (let i = 0; i < weights.length; i++) {
      const m = magnitudes[startBin + i]!;
      sum += weights[i]! * m * m;
    }
    out[b] = sum;
  }
  return out;
}

/**
 * Floors for log energies:
 *  - absolute −100 dB re full scale: digital silence would otherwise give
 *    log(0) = −∞;
 *  - relative: 60 dB below the frame's loudest band ("top dB"). Bands that
 *    far below the peak are essentially inaudible next to it, but their exact
 *    level (faint hiss, filter leakage) would otherwise swing the MFCCs and
 *    make them depend on overall volume.
 */
const MEL_ENERGY_FLOOR = 1e-10;
const MEL_TOP_DB = 60;

/**
 * MFCC: log mel energies → DCT-II (orthonormal). The DCT turns the smooth
 * shape of the spectrum (the timbre "colour") into a few numbers:
 * c0 ≈ overall loudness, c1 ≈ spectral tilt (dark vs bright), higher
 * coefficients ≈ finer detail. A constant loudness change only affects c0.
 */
export function mfccFromMelEnergies(energies: ArrayLike<number>, count: number, out: Float64Array): Float64Array {
  const n = energies.length;
  let peak = 0;
  for (let i = 0; i < n; i++) if (energies[i]! > peak) peak = energies[i]!;
  const floor = Math.max(MEL_ENERGY_FLOOR, peak * 10 ** (-MEL_TOP_DB / 10));
  const logs = new Float64Array(n);
  for (let i = 0; i < n; i++) logs[i] = Math.log(Math.max(energies[i]!, floor));
  for (let k = 0; k < count; k++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += logs[i]! * Math.cos((Math.PI * k * (i + 0.5)) / n);
    out[k] = sum * (k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n));
  }
  return out;
}

/** Mel energies as dB (for visuals), floored like the MFCC input. */
export function melEnergiesToDb(energies: ArrayLike<number>): number[] {
  return Array.from(energies, (e) => 10 * Math.log10(Math.max(e, MEL_ENERGY_FLOOR)));
}
