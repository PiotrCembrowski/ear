/**
 * `pitch` strategy: for musical notes (instrument note samples).
 *
 * Measures the fundamental frequency (f0) over the stable part of the note
 * and compares it with the reference's MEASURED f0 (not its nominal note
 * frequency), so a piano tuned to A = 442 Hz is compared fairly.
 *
 * Score (documented heuristic): score = 100 · cos²(π · min(|cents|, 50) / 100)
 *   0 cents → 100,  5 → 98,  10 → 90,  25 → 50,  ≥ 50 → 0.
 * Within a few cents people hear "in tune", so the curve is flat near 0 and
 * falls fastest around a quarter-tone (25 cents).
 */
import { z } from "zod";
import { ANALYSIS_SAMPLE_RATE, DEFAULT_A4_HZ, MAX_EVENT_MS } from "../constants";
import { createMelFilterbank, melEnergies, melEnergiesToDb, type MelFilterbank } from "../features";
import { LevelStats, type EventStats } from "../level-stats";
import { centsBetween, clamp, median, round, standardDeviation } from "../math";
import { nearestNote } from "../notes";
import { PitchTracker, type PitchFrame } from "../pitch-tracker";
import { levelWarnings, uniqueWarnings, warning } from "../quality";
import { StreamingResampler } from "../resampler";
import { SpectrumAnalyzer } from "../spectrum";
import type {
  AudioClip,
  Characteristic,
  ComparisonResult,
  ComparisonStrategy,
  CompareContext,
  FeatureSet,
  LiveAnalyzer,
  LiveReading,
  QualityWarning,
} from "../types";

export const PITCH_STRATEGY_ID = "pitch";
export const PITCH_STRATEGY_VERSION = "1.0.0";

/** Frames with at least this MPM clarity count as "voiced" (a clear pitch). */
const CLARITY_THRESHOLD = 0.9;
/** Skip the attack: hammer/pluck noise makes the first ~60 ms unreliable. */
const ATTACK_SKIP_MS = 60;
/** A cluster is one note: frames within ±50 cents of its centre. */
const CLUSTER_HALF_WIDTH_CENTS = 50;
/** A second cluster counts as another note if it has ≥ 5 frames and ≥ 15% of voiced frames. */
const SECOND_NOTE_MIN_FRAMES = 5;
const SECOND_NOTE_MIN_SHARE = 0.15;
/** Standard deviation (cents) above which we warn about an unstable pitch. */
const UNSTABLE_CENTS = 15;
/** Fewer voiced frames than this: no clear pitch. */
const MIN_VOICED_FRAMES = 3;
/** Points kept for the pitch-track visual. */
const TRACK_POINTS = 64;
/** Early finish: this many clear frames after the attack (~0.6 s at a 23 ms hop)… */
const EARLY_FINISH_FRAMES = 26;
/** …with the most recent ~0.25 s steady within ±20 cents of their median. */
const EARLY_FINISH_RECENT_FRAMES = 11;
const EARLY_FINISH_STEADY_CENTS = 20;
/** Mel bands for the average-spectrum visual. */
const SPECTRUM_BANDS = 24;

const eventStatsSchema = z.object({
  durationMs: z.number(),
  rmsDb: z.number(),
  peakDb: z.number(),
  clippedFraction: z.number(),
});

const pitchDataSchema = z.object({
  /** Median f0 of the main note, Hz; null when no clear pitch. */
  f0Hz: z.number().positive().nullable(),
  /** Share of analysed frames that belong to the main note (0..1). */
  voicedShare: z.number().min(0).max(1),
  /** Median MPM clarity of the main note's frames (0..1). */
  clarity: z.number().min(0).max(1),
  /** Standard deviation of the main note's pitch, cents. */
  stabilityCents: z.number().min(0),
  /** Distinct stable notes found (1 normally). */
  noteCount: z.number().int().min(0),
  /** The tracker jumped by an octave during the note (detector uncertainty). */
  octaveJumps: z.boolean(),
  track: z.object({ timeMs: z.array(z.number()), hz: z.array(z.number()) }),
  spectrum: z.object({ bandHz: z.array(z.number()), db: z.array(z.number()) }),
  stats: eventStatsSchema,
});

export type PitchFeatureData = z.infer<typeof pitchDataSchema>;
export type PitchFeatures = FeatureSet<PitchFeatureData>;

const featureSetSchema = z.object({
  strategyId: z.literal(PITCH_STRATEGY_ID),
  algorithmVersion: z.string(),
  data: pitchDataSchema,
});

/** 0 cents → 100, ≥ 50 cents → 0 (see the file header). */
export function centsToScore(cents: number): number {
  const c = Math.min(Math.abs(cents), 50);
  return 100 * Math.cos((Math.PI * c) / 100) ** 2;
}

type Cluster = { centre: number; members: PitchFrame[] };

/** Groups voiced frames into notes: the densest 100-cent segment first, then the next. */
function clusterNotes(frames: PitchFrame[]): Cluster[] {
  const remaining = frames.map((f) => ({ frame: f, cents: 1200 * Math.log2(f.hz / 440) }));
  const clusters: Cluster[] = [];
  while (remaining.length > 0 && clusters.length < 3) {
    const sorted = [...remaining].sort((a, b) => a.cents - b.cents);
    let bestStart = 0;
    let bestCount = 0;
    let end = 0;
    for (let start = 0; start < sorted.length; start++) {
      while (end < sorted.length && sorted[end]!.cents - sorted[start]!.cents <= 2 * CLUSTER_HALF_WIDTH_CENTS) end++;
      if (end - start > bestCount) {
        bestCount = end - start;
        bestStart = start;
      }
    }
    const segment = sorted.slice(bestStart, bestStart + bestCount);
    const centre = median(segment.map((w) => w.cents));
    const members = remaining.filter((r) => Math.abs(r.cents - centre) <= CLUSTER_HALF_WIDTH_CENTS);
    clusters.push({ centre, members: members.map((m) => m.frame) });
    for (const m of members) remaining.splice(remaining.indexOf(m), 1);
  }
  return clusters;
}

/** Turns the frame-by-frame track into the stored summary. Pure and deterministic. */
function summarize(frames: PitchFrame[], mel: { sum: Float64Array; count: number; bank: MelFilterbank }, stats: EventStats): PitchFeatureData {
  const usable = stats.durationMs > 4 * ATTACK_SKIP_MS ? frames.filter((f) => f.timeMs >= ATTACK_SKIP_MS) : frames;
  const voiced = usable.filter((f) => f.hz > 0 && f.clarity >= CLARITY_THRESHOLD);
  const clusters = voiced.length >= MIN_VOICED_FRAMES ? clusterNotes(voiced) : [];
  const main = clusters[0];
  const others = clusters.slice(1).filter((c) => c.members.length >= Math.max(SECOND_NOTE_MIN_FRAMES, SECOND_NOTE_MIN_SHARE * voiced.length));
  const isOctaveOfMain = (c: Cluster) => main !== undefined && Math.abs(Math.abs(c.centre - main.centre) - 1200) <= CLUSTER_HALF_WIDTH_CENTS;

  const mainHz = main ? main.members.map((f) => f.hz) : [];
  const f0Hz = main && main.members.length >= MIN_VOICED_FRAMES ? median(mainHz) : null;
  const centsSpread = f0Hz ? standardDeviation(mainHz.map((hz) => centsBetween(hz, f0Hz))) : 0;

  const step = Math.max(1, Math.ceil(frames.length / TRACK_POINTS));
  const sampled = frames.filter((_, i) => i % step === 0);
  const spectrumDb = mel.count > 0 ? melEnergiesToDb(mel.sum.map((e) => e / mel.count)) : new Array<number>(SPECTRUM_BANDS).fill(-100);
  const peakDb = Math.max(...spectrumDb);

  return {
    f0Hz: f0Hz ? round(f0Hz, 4) : null,
    voicedShare: round(usable.length ? (main?.members.length ?? 0) / usable.length : 0, 3),
    clarity: round(main ? median(main.members.map((f) => f.clarity)) : 0, 3),
    stabilityCents: round(centsSpread, 2),
    noteCount: main ? 1 + others.filter((c) => !isOctaveOfMain(c)).length : 0,
    octaveJumps: others.some(isOctaveOfMain),
    track: {
      timeMs: sampled.map((f) => round(f.timeMs, 1)),
      hz: sampled.map((f) => (f.clarity >= CLARITY_THRESHOLD ? round(f.hz, 3) : 0)),
    },
    spectrum: {
      bandHz: mel.bank.centerHz.map((hz) => round(hz, 0)),
      db: spectrumDb.map((db) => round(clamp(db - peakDb, -80, 0), 1)),
    },
    stats,
  };
}

class PitchAnalyzer implements LiveAnalyzer<PitchFeatureData> {
  readonly inputSampleRate: number;
  private readonly resampler: StreamingResampler;
  private readonly tracker = new PitchTracker(ANALYSIS_SAMPLE_RATE);
  private readonly levels: LevelStats;
  private readonly spectrum = new SpectrumAnalyzer(2048);
  private readonly magnitudes = new Float64Array(1025);
  private readonly bank = createMelFilterbank(ANALYSIS_SAMPLE_RATE, 2048, SPECTRUM_BANDS, 40, 8000);
  private readonly melFrame = new Float64Array(SPECTRUM_BANDS);
  private readonly melSum = new Float64Array(SPECTRUM_BANDS);
  private melCount = 0;
  private frames: PitchFrame[] = [];
  private latest: PitchFrame | null = null;
  /** Analysis-rate samples for the spectrum (2048-sample frames, hop 2048). */
  private readonly spectrumBuffer = new Float32Array(2048);
  private spectrumFilled = 0;

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
    const maxFrames = Math.ceil((MAX_EVENT_MS / 1000) * (ANALYSIS_SAMPLE_RATE / 512)) + 8;
    this.tracker.push(samples, (frame) => {
      this.latest = frame;
      if (this.frames.length < maxFrames) this.frames.push(frame);
    });
    // Average spectrum over non-overlapping 2048-sample frames (for the visual only).
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(2048 - this.spectrumFilled, samples.length - offset);
      this.spectrumBuffer.set(samples.subarray(offset, offset + take), this.spectrumFilled);
      this.spectrumFilled += take;
      offset += take;
      if (this.spectrumFilled === 2048) {
        this.spectrum.magnitudes(this.spectrumBuffer, this.magnitudes);
        melEnergies(this.magnitudes, this.bank, this.melFrame);
        for (let b = 0; b < SPECTRUM_BANDS; b++) this.melSum[b]! += this.melFrame[b]!;
        this.melCount++;
        this.spectrumFilled = 0;
      }
    }
  }

  readyToFinish(): boolean {
    const clear = this.frames.filter((f) => f.timeMs >= ATTACK_SKIP_MS && f.hz > 0 && f.clarity >= CLARITY_THRESHOLD);
    if (clear.length < EARLY_FINISH_FRAMES) return false;
    const recent = clear.slice(-EARLY_FINISH_RECENT_FRAMES).map((f) => f.hz);
    const centre = median(recent);
    return recent.every((hz) => Math.abs(centsBetween(hz, centre)) <= EARLY_FINISH_STEADY_CENTS);
  }

  snapshot(): LiveReading {
    const f = this.latest;
    return {
      levelDb: f ? round(f.levelDb, 1) : -120,
      pitch: f && f.hz > 0 && f.clarity >= 0.8 ? { hz: f.hz, clarity: f.clarity } : null,
      elapsedMs: this.levels.elapsedMs,
    };
  }

  finish(): PitchFeatures {
    // Drain the resampler so the last few milliseconds are analysed too.
    this.consume(this.resampler.flush());
    return {
      strategyId: PITCH_STRATEGY_ID,
      algorithmVersion: PITCH_STRATEGY_VERSION,
      data: summarize(this.frames, { sum: this.melSum, count: this.melCount, bank: this.bank }, this.levels.result()),
    };
  }

  reset(): void {
    this.resampler.reset();
    this.tracker.reset();
    this.levels.reset();
    this.frames = [];
    this.latest = null;
    this.melSum.fill(0);
    this.melCount = 0;
    this.spectrumFilled = 0;
  }
}

/** Warnings that come from the pitch features alone. */
export function pitchWarnings(data: PitchFeatureData): QualityWarning[] {
  const warnings = levelWarnings(data.stats);
  if (data.f0Hz === null) warnings.push(warning("no_clear_pitch"));
  if (data.noteCount > 1) warnings.push(warning("multiple_notes"));
  if (data.f0Hz !== null && data.stabilityCents > UNSTABLE_CENTS) warnings.push(warning("unstable_pitch"));
  return warnings;
}

export type ConfidenceLevel = "high" | "medium" | "low";

/** Combines how much of the sound had a clear pitch with how clear it was. */
export function pitchConfidence(data: PitchFeatureData): { value: number; level: ConfidenceLevel } {
  if (data.f0Hz === null) return { value: 0, level: "low" };
  const stabilityFactor = clamp(1 - Math.max(0, data.stabilityCents - 5) / 40, 0, 1);
  const value = round(clamp(data.voicedShare * data.clarity * stabilityFactor * (data.noteCount > 1 ? 0.7 : 1), 0, 1), 3);
  return { value, level: value >= 0.7 ? "high" : value >= 0.4 ? "medium" : "low" };
}

function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  return rounded === 0 ? "in tune" : `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)} cents`;
}

function commonCharacteristics(data: PitchFeatureData, a4Hz: number): Characteristic[] {
  const list: Characteristic[] = [];
  if (data.f0Hz !== null) {
    const note = nearestNote(data.f0Hz, a4Hz);
    list.push({ id: "note", label: "Note", value: note.midi, unit: "midi", display: `${note.name}, ${formatCents(note.cents)}` });
    list.push({ id: "pitch", label: "Pitch", value: round(data.f0Hz, 2), unit: "Hz", display: `${data.f0Hz.toFixed(1)} Hz` });
    list.push({ id: "stability", label: "Stability", value: data.stabilityCents, unit: "cents", display: `±${data.stabilityCents.toFixed(0)} cents` });
  }
  list.push({ id: "duration", label: "Duration", value: data.stats.durationMs, unit: "ms", display: `${(data.stats.durationMs / 1000).toFixed(2)} s` });
  list.push({ id: "loudness", label: "Loudness", value: data.stats.rmsDb, unit: "dBFS", display: `${data.stats.rmsDb.toFixed(0)} dBFS` });
  return list;
}

export type NoteReading = {
  hz: number;
  midi: number;
  name: string;
  cents: number;
  confidence: { value: number; level: ConfidenceLevel };
  warnings: QualityWarning[];
  characteristics: Characteristic[];
};

/** Identify mode: names the note of one sound event (no reference needed). */
export function identifyNote(features: PitchFeatures, a4Hz: number = DEFAULT_A4_HZ): NoteReading | null {
  const { data } = features;
  if (data.f0Hz === null) return null;
  const note = nearestNote(data.f0Hz, a4Hz);
  return {
    hz: data.f0Hz,
    midi: note.midi,
    name: note.name,
    cents: round(note.cents, 1),
    confidence: pitchConfidence(data),
    warnings: pitchWarnings(data),
    characteristics: commonCharacteristics(data, a4Hz),
  };
}

function comparePitch(input: PitchFeatures, reference: PitchFeatures, context: CompareContext = {}): ComparisonResult {
  const a4Hz = context.a4Hz ?? DEFAULT_A4_HZ;
  const inputData = input.data;
  const refData = reference.data;
  const base = {
    strategyId: PITCH_STRATEGY_ID,
    algorithmVersion: PITCH_STRATEGY_VERSION,
    characteristics: commonCharacteristics(inputData, a4Hz),
  };
  const spectrum = {
    bandHz: refData.spectrum.bandHz,
    inputDb: inputData.spectrum.db,
    referenceDb: refData.spectrum.db,
  };

  if (inputData.f0Hz === null || refData.f0Hz === null) {
    return {
      ...base,
      score: 0,
      explanation:
        refData.f0Hz === null
          ? "The reference sound has no clear pitch, so pitches can't be compared."
          : "No clear pitch was detected in your sound, so it couldn't be compared with the reference note.",
      breakdown: [{ id: "pitch", label: "Pitch accuracy", score: 0, weight: 1, detail: "No clear pitch to compare." }],
      warnings: uniqueWarnings(pitchWarnings(inputData)),
      visuals: { spectrum },
    };
  }

  const cents = centsBetween(inputData.f0Hz, refData.f0Hz);
  const octaves = Math.round(cents / 1200);
  const octaveError = octaves !== 0 && Math.abs(cents - 1200 * octaves) < 50;
  const score = round(centsToScore(cents), 1);
  const refNote = nearestNote(refData.f0Hz, a4Hz);
  const confidence = pitchConfidence(inputData);
  const octaveDetail = octaveError
    ? ` That is ${Math.abs(octaves)} octave${Math.abs(octaves) > 1 ? "s" : ""} ${octaves > 0 ? "above" : "below"} the reference, ${formatCents(cents - 1200 * octaves)} within the octave.`
    : "";

  return {
    ...base,
    score,
    explanation: `Compared the pitch of your note with the reference ${refNote.name} (${refData.f0Hz.toFixed(1)} Hz). Your note was ${formatCents(cents)} from it.${octaveDetail} The score depends only on that difference: 100 when it matches, 0 at a quarter-tone (50 cents) or more.`,
    breakdown: [
      { id: "pitch", label: "Pitch accuracy", score, weight: 1, detail: `${formatCents(cents)} from the reference` },
      {
        id: "stability",
        label: "Pitch stability",
        score: round(clamp(100 - inputData.stabilityCents * 4, 0, 100), 1),
        weight: 0,
        detail: `Varied by ±${inputData.stabilityCents.toFixed(0)} cents (shown for context, not scored)`,
      },
      {
        id: "confidence",
        label: "Detection confidence",
        score: round(confidence.value * 100, 1),
        weight: 0,
        detail: `${confidence.level[0]!.toUpperCase()}${confidence.level.slice(1)} (shown for context, not scored)`,
      },
    ],
    warnings: uniqueWarnings(pitchWarnings(inputData), octaveError ? [warning("octave_error")] : []),
    visuals: {
      pitchTrack: {
        timeMs: inputData.track.timeMs.filter((_, i) => inputData.track.hz[i]! > 0),
        cents: inputData.track.hz.filter((hz) => hz > 0).map((hz) => round(centsBetween(hz, refData.f0Hz!), 1)),
      },
      spectrum,
    },
  };
}

export const pitchStrategy: ComparisonStrategy<PitchFeatureData> = {
  id: PITCH_STRATEGY_ID,
  version: PITCH_STRATEGY_VERSION,
  label: "Pitch",
  /** Instrument note samples (they have a MIDI note). */
  appliesTo: (reference) => reference.midiNote !== null && reference.midiNote !== undefined,
  createAnalyzer: (sampleRate) => new PitchAnalyzer(sampleRate),
  extract(clip: AudioClip) {
    const analyzer = new PitchAnalyzer(clip.sampleRate);
    analyzer.push(clip.samples);
    return analyzer.finish();
  },
  compare: comparePitch,
  parseFeatures: (value) => featureSetSchema.parse(value),
};

