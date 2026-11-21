/**
 * ListeningSession: everything that happens to live microphone audio, in one
 * pure-TypeScript object (it runs inside the analysis Web Worker, and in
 * Node for tests).
 *
 *   push(block) ─┬─▶ SoundEventDetector ─▶ per-event analyzer ─▶ results
 *                └─▶ live tuner (continuous resampler + pitch tracker)
 *
 * The live tuner runs on ALL audio, independent of sound events, so the
 * readout keeps working on a long sustained note (events are capped at 5 s).
 * It only reports a pitch while the level is above the detector's end
 * threshold, so background noise doesn't make the needle wander.
 *
 * Modes decide what happens to each sound event:
 *   - identify: name the note (pitch analysis);
 *   - compare:  compare with one reference, using the reference's strategy;
 *   - closest:  rank every sample of an instrument (see closest.ts).
 * Changing mode keeps the microphone, detector and tuner running.
 *
 * Pitch-based compare/closest finish EARLY, as soon as the note's pitch is
 * steady (about 0.6 s), instead of waiting for a ringing note to fade; the
 * rest of that sound is then ignored.
 */
import { ANALYSIS_SAMPLE_RATE, DEFAULT_A4_HZ } from "./constants";
import { SoundEventDetector, type DetectorOptions } from "./event-detector";
import { median } from "./math";
import { nearestNote, type NearestNote } from "./notes";
import { PitchTracker, type PitchFrame } from "./pitch-tracker";
import { noiseWarning, uniqueWarnings } from "./quality";
import { StreamingResampler } from "./resampler";
import { rankClosest, type ClosestCandidate, type ClosestResult } from "./closest";
import { defaultRegistry } from "./registry";
import { identifyNote, pitchStrategy, pitchWarnings, type NoteReading, type PitchFeatures } from "./strategies/pitch";
import { timbreStrategy } from "./strategies/timbre";
import type { ComparisonResult, ComparisonStrategy, FeatureSet, LiveAnalyzer, QualityWarning } from "./types";

export type SessionOptions = {
  sensitivityDb: number;
  a4Hz: number;
};

export type TunerReading = {
  hz: number;
  clarity: number;
  note: NearestNote;
};

export type SessionSnapshot = {
  levelDb: number;
  noiseFloorDb: number;
  /** Level a sound must reach to count as a sound event. */
  thresholdDb: number;
  /** True for the first 250 ms while the background is being measured. */
  calibrating: boolean;
  /** A sound event is in progress. */
  soundActive: boolean;
  eventMs: number;
  /** Live tuner reading, or null when there's no clear pitch right now. */
  tuner: TunerReading | null;
};

export type ListeningMode =
  | { mode: "identify" }
  | { mode: "compare"; reference: FeatureSet }
  | { mode: "closest"; primary: "pitch" | "timbre"; candidates: ClosestCandidate[] };

export type SessionEvent =
  | { type: "sound-start" }
  | {
      type: "note";
      /** null when the sound had no clear pitch. */
      reading: NoteReading | null;
      warnings: QualityWarning[];
      durationMs: number;
    }
  | { type: "comparison"; result: ComparisonResult; durationMs: number; finishedEarly: boolean }
  | { type: "closest"; result: ClosestResult; durationMs: number; finishedEarly: boolean };

/** Live tuner: minimum MPM clarity to show a pitch. */
const TUNER_MIN_CLARITY = 0.85;
/** Median over the last few frames (~70 ms) steadies the readout without lagging much. */
const TUNER_SMOOTHING_FRAMES = 3;
/** Clear the readout if no valid frame arrived for this long. */
const TUNER_HOLD_MS = 150;

export class ListeningSession {
  readonly sampleRate: number;
  private options: SessionOptions;
  private readonly detector: SoundEventDetector;
  private mode: ListeningMode = { mode: "identify" };
  /** Strategy for compare mode (the reference's own). */
  private compareStrategy: ComparisonStrategy<unknown> | null = null;
  /** Per-event analyzers for the current mode: the first one is the primary. */
  private analyzers: Array<{ strategy: ComparisonStrategy<unknown>; analyzer: LiveAnalyzer<unknown> }> = [];
  private eventActive = false;
  /** The current event already produced its (early) result; ignore the rest of it. */
  private eventDone = false;
  private eventStartMs = 0;

  // Live tuner path.
  private readonly tunerResampler: StreamingResampler;
  private readonly tunerTracker = new PitchTracker(ANALYSIS_SAMPLE_RATE);
  private recentFrames: PitchFrame[] = [];
  private lastValidFrameMs = -Infinity;
  private tuner: TunerReading | null = null;
  private elapsedMs = 0;

  constructor(sampleRate: number, options: Partial<SessionOptions> = {}, detectorOptions: Partial<DetectorOptions> = {}) {
    this.sampleRate = sampleRate;
    this.options = { sensitivityDb: 12, a4Hz: DEFAULT_A4_HZ, ...options };
    this.detector = new SoundEventDetector(sampleRate, {
      ignoreDigitalSilence: true,
      ...detectorOptions,
      sensitivityDb: this.options.sensitivityDb,
    });
    this.tunerResampler = new StreamingResampler(sampleRate, ANALYSIS_SAMPLE_RATE);
    this.setMode({ mode: "identify" });
  }

  /**
   * Switches what each sound is analysed for. Reference features are
   * validated here (throws on malformed data). A sound in progress is dropped.
   */
  setMode(mode: ListeningMode): void {
    const make = (strategy: ComparisonStrategy<unknown>) => ({ strategy, analyzer: strategy.createAnalyzer(this.sampleRate) });
    if (mode.mode === "identify") {
      this.analyzers = [make(pitchStrategy as ComparisonStrategy<unknown>)];
      this.compareStrategy = null;
    } else if (mode.mode === "compare") {
      const strategy = defaultRegistry.get(mode.reference.strategyId);
      if (!strategy) throw new Error(`Unknown strategy "${mode.reference.strategyId}"`);
      mode = { mode: "compare", reference: strategy.parseFeatures(mode.reference) };
      this.compareStrategy = strategy;
      this.analyzers = [make(strategy)];
    } else {
      const usesTimbre = mode.primary === "timbre" || mode.candidates.some((c) => c.timbre);
      this.analyzers =
        mode.primary === "pitch"
          ? [make(pitchStrategy as ComparisonStrategy<unknown>), ...(usesTimbre ? [make(timbreStrategy as ComparisonStrategy<unknown>)] : [])]
          : [make(timbreStrategy as ComparisonStrategy<unknown>)];
      this.compareStrategy = null;
    }
    this.mode = mode;
    this.eventActive = false;
    this.eventDone = false;
  }

  setSensitivity(sensitivityDb: number): void {
    this.options = { ...this.options, sensitivityDb };
    this.detector.setSensitivity(sensitivityDb);
  }

  setA4(a4Hz: number): void {
    this.options = { ...this.options, a4Hz };
    if (this.tuner) this.tuner = { ...this.tuner, note: nearestNote(this.tuner.hz, a4Hz) };
  }

  /** Feeds one block of microphone audio (any size, at `sampleRate`). */
  push(block: Float32Array): SessionEvent[] {
    const events: SessionEvent[] = [];
    this.elapsedMs += (block.length / this.sampleRate) * 1000;

    for (const output of this.detector.process(block)) {
      if (output.type === "start") {
        for (const { analyzer } of this.analyzers) analyzer.reset();
        this.eventActive = true;
        this.eventDone = false;
        this.eventStartMs = this.elapsedMs;
        events.push({ type: "sound-start" });
      } else if (output.type === "audio") {
        if (!this.eventActive || this.eventDone) continue;
        for (const { analyzer } of this.analyzers) analyzer.push(output.samples);
        if (this.mode.mode !== "identify" && this.analyzers[0]?.analyzer.readyToFinish?.()) {
          this.eventDone = true;
          events.push(this.eventResult(this.elapsedMs - this.eventStartMs, true));
        }
      } else {
        const wasDone = this.eventDone;
        this.eventActive = false;
        this.eventDone = false;
        // Ignore clicks and taps: they would only replace the last real result with noise.
        if (output.tooShort || wasDone) continue;
        events.push(this.eventResult(output.durationMs, false));
      }
    }

    this.tunerTracker.push(this.tunerResampler.push(block), (frame) => this.onTunerFrame(frame));
    if (this.tuner && this.elapsedMs - this.lastValidFrameMs > TUNER_HOLD_MS) this.tuner = null;
    return events;
  }

  /** Finishes the current event's analysis and produces the mode's result. */
  private eventResult(durationMs: number, finishedEarly: boolean): SessionEvent {
    const features = this.analyzers.map(({ analyzer }) => analyzer.finish());
    const primary = features[0]!;
    const noise = (stats: { rmsDb: number; durationMs: number; peakDb: number; clippedFraction: number }) =>
      noiseWarning(stats, this.detector.state.noiseFloorDb);

    if (this.mode.mode === "compare" && this.compareStrategy) {
      const result = this.compareStrategy.compare(primary, this.mode.reference, { a4Hz: this.options.a4Hz });
      const stats = (primary.data as { stats: Parameters<typeof noise>[0] }).stats;
      return { type: "comparison", result: { ...result, warnings: uniqueWarnings(result.warnings, noise(stats)) }, durationMs, finishedEarly };
    }
    if (this.mode.mode === "closest") {
      const byStrategy = Object.fromEntries(features.map((f) => [f.strategyId, f])) as { pitch?: FeatureSet; timbre?: FeatureSet };
      const result = rankClosest(byStrategy, this.mode.candidates, { primary: this.mode.primary, a4Hz: this.options.a4Hz });
      const stats = (primary.data as { stats: Parameters<typeof noise>[0] }).stats;
      return { type: "closest", result: { ...result, warnings: uniqueWarnings(result.warnings, noise(stats)) }, durationMs, finishedEarly };
    }
    const pitch = primary as PitchFeatures;
    return {
      type: "note",
      reading: identifyNote(pitch, this.options.a4Hz),
      warnings: uniqueWarnings(pitchWarnings(pitch.data), noise(pitch.data.stats)),
      durationMs,
    };
  }

  private onTunerFrame(frame: PitchFrame): void {
    const state = this.detector.state;
    // Same rule as the detector's end threshold: quieter than this is background.
    const audible = !this.detector.calibrating && frame.levelDb >= state.thresholdDb - 4;
    if (!audible || frame.hz <= 0 || frame.clarity < TUNER_MIN_CLARITY) return;
    this.recentFrames.push(frame);
    if (this.recentFrames.length > TUNER_SMOOTHING_FRAMES) this.recentFrames.shift();
    // Discard history from a previous, different note so the median doesn't lag a note change.
    const latest = frame.hz;
    this.recentFrames = this.recentFrames.filter((f) => Math.abs(1200 * Math.log2(f.hz / latest)) < 50);
    const hz = median(this.recentFrames.map((f) => f.hz));
    this.tuner = { hz, clarity: frame.clarity, note: nearestNote(hz, this.options.a4Hz) };
    this.lastValidFrameMs = this.elapsedMs;
  }

  snapshot(): SessionSnapshot {
    const state = this.detector.state;
    return {
      levelDb: state.levelDb,
      noiseFloorDb: state.noiseFloorDb,
      thresholdDb: state.thresholdDb,
      calibrating: this.detector.calibrating,
      soundActive: state.active,
      eventMs: state.eventMs,
      tuner: this.tuner,
    };
  }

  /** Ends any sound in progress (e.g. the user pressed Stop) and returns its result. */
  flush(): SessionEvent[] {
    const events: SessionEvent[] = [];
    for (const output of this.detector.flush()) {
      if (output.type === "audio" && this.eventActive && !this.eventDone) {
        for (const { analyzer } of this.analyzers) analyzer.push(output.samples);
      }
      if (output.type === "end") {
        const wasDone = this.eventDone;
        this.eventActive = false;
        this.eventDone = false;
        if (output.tooShort || wasDone) continue;
        events.push(this.eventResult(output.durationMs, false));
      }
    }
    return events;
  }

  reset(): void {
    this.detector.reset();
    for (const { analyzer } of this.analyzers) analyzer.reset();
    this.eventActive = false;
    this.eventDone = false;
    this.tunerResampler.reset();
    this.tunerTracker.reset();
    this.recentFrames = [];
    this.lastValidFrameMs = -Infinity;
    this.tuner = null;
    this.elapsedMs = 0;
  }
}
