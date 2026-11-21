/**
 * `timbre` strategy: for general sounds (a dog bark, a door, a drum hit, a
 * sung vowel without a MIDI note). It compares HOW a sound sounds, not its
 * pitch.
 *
 * Per frame (2048 samples ≈ 93 ms, hop 1024 ≈ 46 ms → ~21.5 frames/s):
 *   - MFCC c1..c12: the shape of the spectrum (tone colour), loudness-free.
 *   - spectral centroid (brightness) and rolloff (high-frequency content), Hz,
 *     both POWER-weighted so faint background hiss barely moves them.
 *   - RMS level per frame, dBFS (used to weight brightness by loudness).
 * Plus a FINE loudness envelope: RMS every 256 samples (≈ 11.6 ms), so the
 * shape of fast sounds (claps, knocks, drum hits decaying in < 100 ms) is
 * captured; the 46 ms MFCC hop alone would smear it.
 *
 * Comparison:
 *   1. DTW aligns the two MFCC sequences (sounds may be a little faster or
 *      slower), with frame cost = RMS difference across the 12 coefficients.
 *   2. The loudness envelopes are compared on each sound's own normalized
 *      timeline (start → end), each relative to its own peak, so overall
 *      volume doesn't matter but the SHAPE (sharp hit vs steady) does.
 *   3. Average brightness and rolloff are compared as frequency ratios
 *      (octaves), so the same ratio counts the same in bass and treble.
 *   4. Length is compared as a ratio (twice as long = 1 octave of ratio).
 *   Each distance d becomes a sub-score with a log-logistic curve
 *       sub-score = 100 / (1 + (d / d50)^p)
 *   where d50 is the distance that scores 50 and p the steepness. (A plain
 *   exponential can't map "same sound" distances ≈ 1 to ~85 and "different
 *   sound" distances ≈ 3 to below 30 at the same time; this curve can.)
 *   The overall score is the weighted sum: MFCC 0.5, envelope 0.15,
 *   brightness 0.15, rolloff 0.1, length 0.1.
 *
 * Only the "body" of the sound is compared: frames more than 35 dB below the
 * event's loudest frame (the fade into background noise) are trimmed from
 * both ends in finish(), because in that tail the room noise, not the sound,
 * decides the spectrum.
 *
 * Calibration: d50 and p below were set with `scripts/evaluate-engine.ts` on
 * labelled synthetic pairs so that the same sound re-played scores high,
 * related sounds land in the middle and unrelated sounds score low. They are
 * heuristics, not validated measures; re-run the script with real
 * recordings in fixtures/real/ to refine them.
 */
import { z } from "zod";
import { ANALYSIS_SAMPLE_RATE, MAX_EVENT_MS } from "../constants";
import { dtw } from "../dtw";
import {
  createMelFilterbank,
  melEnergies,
  melEnergiesToDb,
  mfccFromMelEnergies,
  rmsDb,
  spectralCentroid,
  spectralRolloff,
} from "../features";
import { Framer } from "../framer";
import { LevelStats } from "../level-stats";
import { amplitudeToDb, clamp, mean, resampleSeries, round } from "../math";
import { levelWarnings, uniqueWarnings } from "../quality";
import { StreamingResampler } from "../resampler";
import { SpectrumAnalyzer } from "../spectrum";
import type { AudioClip, ComparisonResult, ComparisonStrategy, FeatureSet, LiveAnalyzer, LiveReading } from "../types";

export const TIMBRE_STRATEGY_ID = "timbre";
export const TIMBRE_STRATEGY_VERSION = "1.0.0";

const FRAME_SIZE = 2048;
const HOP_SIZE = 1024;
const MEL_BANDS = 26;
const MEL_MIN_HZ = 30;
const MEL_MAX_HZ = 8000;
const MFCC_COUNT = 13; // c0..c12; c0 (loudness) is dropped before storing
/** Envelope floor relative to the event's peak, dB: quieter frames are "silence". */
const ENVELOPE_FLOOR_DB = -60;
/** Frames quieter than this (relative to the loudest frame) are trimmed from both ends. */
const BODY_RANGE_DB = 35;
const ENVELOPE_POINTS = 48;
/** Fine envelope block: 256 samples at 22,050 Hz ≈ 11.6 ms. */
const ENVELOPE_BLOCK = 256;

/** Calibrated curve constants (see file header and scripts/evaluate-engine.ts). */
export const TIMBRE_CALIBRATION = {
  /** MFCC distance: RMS difference over c1..c12 (natural-log units) after DTW alignment. */
  mfcc: { d50: 2.3, p: 3 },
  /** Mean envelope difference along the alignment, dB. */
  envelopeDb: { d50: 6, p: 2 },
  /** Brightness (spectral centroid) difference, octaves. */
  centroidOctaves: { d50: 0.5, p: 2 },
  /** Rolloff difference, octaves. */
  rolloffOctaves: { d50: 0.6, p: 2 },
  /** Length difference, |log2(duration ratio)|: 1 = one sound twice as long. */
  durationRatioOctaves: { d50: 1, p: 2 },
} as const;

const WEIGHTS = { mfcc: 0.5, envelope: 0.15, brightness: 0.15, rolloff: 0.1, duration: 0.1 } as const;

const timbreDataSchema = z.object({
  frameRate: z.number().positive(),
  /** One row per frame: MFCC c1..c12. */
  mfcc: z.array(z.array(z.number()).length(MFCC_COUNT - 1)),
  centroidHz: z.array(z.number()),
  rolloffHz: z.array(z.number()),
  rmsDb: z.array(z.number()),
  /** Fine loudness envelope (dBFS), one value per `envelopeRate`⁻¹ seconds, trimmed to the body. */
  envelopeRate: z.number().positive(),
  envelopeDb: z.array(z.number()),
  spectrum: z.object({ bandHz: z.array(z.number()), db: z.array(z.number()) }),
  stats: z.object({ durationMs: z.number(), rmsDb: z.number(), peakDb: z.number(), clippedFraction: z.number() }),
});

export type TimbreFeatureData = z.infer<typeof timbreDataSchema>;
export type TimbreFeatures = FeatureSet<TimbreFeatureData>;

const featureSetSchema = z.object({
  strategyId: z.literal(TIMBRE_STRATEGY_ID),
  algorithmVersion: z.string(),
  data: timbreDataSchema,
});

class TimbreAnalyzer implements LiveAnalyzer<TimbreFeatureData> {
  readonly inputSampleRate: number;
  private readonly resampler: StreamingResampler;
  private readonly framer = new Framer(FRAME_SIZE, HOP_SIZE);
  private readonly levels: LevelStats;
  private readonly spectrum = new SpectrumAnalyzer(FRAME_SIZE);
  private readonly magnitudes = new Float64Array(FRAME_SIZE / 2 + 1);
  private readonly bank = createMelFilterbank(ANALYSIS_SAMPLE_RATE, FRAME_SIZE, MEL_BANDS, MEL_MIN_HZ, MEL_MAX_HZ);
  private readonly mel = new Float64Array(MEL_BANDS);
  private readonly mfccFrame = new Float64Array(MFCC_COUNT);
  private readonly melSum = new Float64Array(MEL_BANDS);
  private mfcc: number[][] = [];
  private centroid: number[] = [];
  private rolloff: number[] = [];
  private envelope: number[] = [];
  private fineEnvelope: number[] = [];
  private fineSumSquares = 0;
  private fineCount = 0;
  private lastLevelDb = -120;
  private readonly maxEnvelopeBlocks = Math.ceil((MAX_EVENT_MS / 1000) * (ANALYSIS_SAMPLE_RATE / ENVELOPE_BLOCK)) + 2;
  private readonly maxFrames = Math.ceil((MAX_EVENT_MS / 1000) * (ANALYSIS_SAMPLE_RATE / HOP_SIZE)) + 2;

  constructor(sampleRate: number) {
    this.inputSampleRate = sampleRate;
    this.resampler = new StreamingResampler(sampleRate, ANALYSIS_SAMPLE_RATE);
    this.levels = new LevelStats(sampleRate);
  }

  push(block: Float32Array): void {
    this.levels.push(block);
    this.consume(this.resampler.push(block));
  }

  private consume(samples: Float32Array): void {
    this.framer.push(samples, this.onFrame);
    for (let i = 0; i < samples.length; i++) {
      this.fineSumSquares += samples[i]! * samples[i]!;
      if (++this.fineCount === ENVELOPE_BLOCK) this.closeEnvelopeBlock();
    }
  }

  private closeEnvelopeBlock(): void {
    if (this.fineCount === 0) return;
    if (this.fineEnvelope.length < this.maxEnvelopeBlocks) {
      this.fineEnvelope.push(round(amplitudeToDb(Math.sqrt(this.fineSumSquares / this.fineCount)), 1));
    }
    this.fineSumSquares = 0;
    this.fineCount = 0;
  }

  private readonly onFrame = (frame: Float32Array): void => {
    this.lastLevelDb = rmsDb(frame);
    if (this.mfcc.length >= this.maxFrames) return;
    this.spectrum.magnitudes(frame, this.magnitudes);
    melEnergies(this.magnitudes, this.bank, this.mel);
    mfccFromMelEnergies(this.mel, MFCC_COUNT, this.mfccFrame);
    for (let b = 0; b < MEL_BANDS; b++) this.melSum[b]! += this.mel[b]!;
    // Rounded at the source, so stored features equal compared features exactly.
    this.mfcc.push(Array.from(this.mfccFrame.subarray(1), (c) => round(c, 3)));
    this.centroid.push(round(spectralCentroid(this.magnitudes, ANALYSIS_SAMPLE_RATE, FRAME_SIZE, 2), 0));
    this.rolloff.push(round(spectralRolloff(this.magnitudes, ANALYSIS_SAMPLE_RATE, FRAME_SIZE, 0.85, 2), 0));
    this.envelope.push(round(this.lastLevelDb, 1));
  };

  snapshot(): LiveReading {
    return { levelDb: round(this.lastLevelDb, 1), pitch: null, elapsedMs: this.levels.elapsedMs };
  }

  finish(): TimbreFeatures {
    this.consume(this.resampler.flush());
    this.closeEnvelopeBlock();
    this.framer.flushIfEmpty(this.onFrame);
    const frames = Math.max(1, this.mfcc.length);
    const spectrumDb = melEnergiesToDb(this.melSum.map((e) => e / frames));
    const peak = Math.max(...spectrumDb);
    const [first, last] = bodyRange(this.envelope);
    const [fineFirst, fineLast] = bodyRange(this.fineEnvelope);
    return {
      strategyId: TIMBRE_STRATEGY_ID,
      algorithmVersion: TIMBRE_STRATEGY_VERSION,
      data: {
        frameRate: round(ANALYSIS_SAMPLE_RATE / HOP_SIZE, 4),
        mfcc: this.mfcc.slice(first, last + 1),
        centroidHz: this.centroid.slice(first, last + 1),
        rolloffHz: this.rolloff.slice(first, last + 1),
        rmsDb: this.envelope.slice(first, last + 1),
        envelopeRate: round(ANALYSIS_SAMPLE_RATE / ENVELOPE_BLOCK, 4),
        envelopeDb: this.fineEnvelope.slice(fineFirst, fineLast + 1),
        spectrum: {
          bandHz: this.bank.centerHz.map((hz) => round(hz, 0)),
          db: spectrumDb.map((db) => round(clamp(db - peak, -80, 0), 1)),
        },
        stats: this.levels.result(),
      },
    };
  }

  reset(): void {
    this.resampler.reset();
    this.framer.reset();
    this.levels.reset();
    this.melSum.fill(0);
    this.mfcc = [];
    this.centroid = [];
    this.rolloff = [];
    this.envelope = [];
    this.fineEnvelope = [];
    this.fineSumSquares = 0;
    this.fineCount = 0;
    this.lastLevelDb = -120;
  }
}

/** First and last frame within BODY_RANGE_DB of the loudest frame (whole range if empty). */
function bodyRange(levelsDb: number[]): [number, number] {
  if (levelsDb.length === 0) return [0, -1];
  const floor = Math.max(...levelsDb) - BODY_RANGE_DB;
  let first = 0;
  while (first < levelsDb.length - 1 && levelsDb[first]! < floor) first++;
  let last = levelsDb.length - 1;
  while (last > first && levelsDb[last]! < floor) last--;
  return [first, last];
}

/** Envelope relative to its own peak, floored, so overall volume doesn't matter. */
function normalizedEnvelope(levels: number[]): number[] {
  const peak = Math.max(...levels);
  return levels.map((db) => Math.max(db - peak, ENVELOPE_FLOOR_DB));
}

/** Energy-weighted average of a per-frame series (quiet frames count much less). */
function weightedMean(values: number[], levelsDb: number[]): number {
  let sum = 0;
  let weights = 0;
  for (let i = 0; i < values.length; i++) {
    const w = 10 ** (levelsDb[i]! / 10); // power, not amplitude
    sum += values[i]! * w;
    weights += w;
  }
  return weights > 0 ? sum / weights : mean(values);
}

function octavesApart(a: number, b: number): number {
  return Math.abs(Math.log2(Math.max(a, 20) / Math.max(b, 20)));
}

/** Log-logistic curve: 100 at distance 0, 50 at d50, falling faster for larger p. */
export function distanceToScore(distance: number, curve: { d50: number; p: number }): number {
  if (!Number.isFinite(distance)) return 0;
  return round(100 / (1 + (Math.max(0, distance) / curve.d50) ** curve.p), 1);
}

function compareTimbre(input: TimbreFeatures, reference: TimbreFeatures): ComparisonResult {
  const a = input.data;
  const b = reference.data;
  const coefficientCount = MFCC_COUNT - 1;

  // 1. Align the MFCC sequences.
  const alignment = dtw(
    a.mfcc.length,
    b.mfcc.length,
    (i, j) => {
      const x = a.mfcc[i]!;
      const y = b.mfcc[j]!;
      let sum = 0;
      for (let k = 0; k < coefficientCount; k++) sum += (x[k]! - y[k]!) ** 2;
      return Math.sqrt(sum / coefficientCount);
    },
    {},
  );
  const mfccDistance = alignment.meanCost;

  // 2. Envelope shape on each sound's own normalized timeline.
  const envA = resampleSeries(normalizedEnvelope(a.envelopeDb), ENVELOPE_POINTS);
  const envB = resampleSeries(normalizedEnvelope(b.envelopeDb), ENVELOPE_POINTS);
  const envelopeDistance = envA.length && envB.length ? mean(envA.map((v, i) => Math.abs(v - envB[i]!))) : Math.abs(ENVELOPE_FLOOR_DB);

  // 3. Brightness and rolloff as frequency ratios.
  const centroidA = weightedMean(a.centroidHz, a.rmsDb);
  const centroidB = weightedMean(b.centroidHz, b.rmsDb);
  const rolloffA = weightedMean(a.rolloffHz, a.rmsDb);
  const rolloffB = weightedMean(b.rolloffHz, b.rmsDb);
  const centroidOctaves = octavesApart(centroidA, centroidB);
  const rolloffOctaves = octavesApart(rolloffA, rolloffB);
  // 4. Length ratio of the body of each sound (from the fine envelope).
  const secondsA = Math.max(1, a.envelopeDb.length) / a.envelopeRate;
  const secondsB = Math.max(1, b.envelopeDb.length) / b.envelopeRate;
  const durationOctaves = Math.abs(Math.log2(secondsA / secondsB));

  const scores = {
    mfcc: distanceToScore(mfccDistance, TIMBRE_CALIBRATION.mfcc),
    envelope: distanceToScore(envelopeDistance, TIMBRE_CALIBRATION.envelopeDb),
    brightness: distanceToScore(centroidOctaves, TIMBRE_CALIBRATION.centroidOctaves),
    rolloff: distanceToScore(rolloffOctaves, TIMBRE_CALIBRATION.rolloffOctaves),
    duration: distanceToScore(durationOctaves, TIMBRE_CALIBRATION.durationRatioOctaves),
  };
  const score = round(
    (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).reduce((sum, key) => sum + WEIGHTS[key] * scores[key], 0),
    1,
  );
  const brighter = centroidA >= centroidB ? "brighter" : "darker";

  return {
    strategyId: TIMBRE_STRATEGY_ID,
    algorithmVersion: TIMBRE_STRATEGY_VERSION,
    score,
    explanation:
      "Compared the tone colour of your sound with the reference over time (after lining the two up, so small timing differences don't count), plus its loudness shape, brightness, high-frequency content and length. Overall volume is ignored.",
    breakdown: [
      { id: "mfcc", label: "Tone colour", score: scores.mfcc, weight: WEIGHTS.mfcc, detail: `Spectral-shape distance ${mfccDistance.toFixed(2)} after alignment` },
      { id: "envelope", label: "Loudness shape", score: scores.envelope, weight: WEIGHTS.envelope, detail: `Shapes differ by ${envelopeDistance.toFixed(1)} dB on average` },
      {
        id: "brightness",
        label: "Brightness",
        score: scores.brightness,
        weight: WEIGHTS.brightness,
        detail: `${Math.round(centroidA)} Hz vs ${Math.round(centroidB)} Hz (${brighter}, ${centroidOctaves.toFixed(2)} octaves)`,
      },
      {
        id: "rolloff",
        label: "High-frequency content",
        score: scores.rolloff,
        weight: WEIGHTS.rolloff,
        detail: `Rolloff ${Math.round(rolloffA)} Hz vs ${Math.round(rolloffB)} Hz`,
      },
      {
        id: "duration",
        label: "Length",
        score: scores.duration,
        weight: WEIGHTS.duration,
        detail: `${secondsA.toFixed(2)} s vs ${secondsB.toFixed(2)} s of sound`,
      },
    ],
    characteristics: [
      { id: "duration", label: "Duration", value: a.stats.durationMs, unit: "ms", display: `${(a.stats.durationMs / 1000).toFixed(2)} s` },
      { id: "loudness", label: "Loudness", value: a.stats.rmsDb, unit: "dBFS", display: `${a.stats.rmsDb.toFixed(0)} dBFS` },
      { id: "peak", label: "Peak", value: a.stats.peakDb, unit: "dBFS", display: `${a.stats.peakDb.toFixed(1)} dBFS` },
      { id: "brightness", label: "Brightness", value: round(centroidA, 0), unit: "Hz", display: `${Math.round(centroidA)} Hz` },
    ],
    warnings: uniqueWarnings(levelWarnings(a.stats)),
    visuals: {
      spectrum: { bandHz: b.spectrum.bandHz, inputDb: a.spectrum.db, referenceDb: b.spectrum.db },
      envelope: {
        inputDb: envA.map((v) => round(v, 1)),
        referenceDb: envB.map((v) => round(v, 1)),
      },
    },
  };
}

export const timbreStrategy: ComparisonStrategy<TimbreFeatureData> = {
  id: TIMBRE_STRATEGY_ID,
  version: TIMBRE_STRATEGY_VERSION,
  label: "Timbre",
  /** Fallback: applies to every reference (the registry tries more specific strategies first). */
  appliesTo: () => true,
  createAnalyzer: (sampleRate) => new TimbreAnalyzer(sampleRate),
  extract(clip: AudioClip) {
    const analyzer = new TimbreAnalyzer(clip.sampleRate);
    analyzer.push(clip.samples);
    return analyzer.finish();
  },
  compare: compareTimbre,
  parseFeatures: (value) => featureSetSchema.parse(value),
};
