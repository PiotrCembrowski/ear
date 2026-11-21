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
 * Phase 5 implements "identify" (name the note). Compare and closest-match
 * modes add their own per-event analyzers in Phase 7.
 */
import { ANALYSIS_SAMPLE_RATE, DEFAULT_A4_HZ } from "./constants";
import { SoundEventDetector, type DetectorOptions } from "./event-detector";
import { median } from "./math";
import { nearestNote, type NearestNote } from "./notes";
import { PitchTracker, type PitchFrame } from "./pitch-tracker";
import { noiseWarning, uniqueWarnings } from "./quality";
import { StreamingResampler } from "./resampler";
import { identifyNote, pitchStrategy, pitchWarnings, type NoteReading, type PitchFeatures } from "./strategies/pitch";
import type { LiveAnalyzer, QualityWarning } from "./types";

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

export type SessionEvent =
  | { type: "sound-start" }
  | {
      type: "note";
      /** null when the sound had no clear pitch. */
      reading: NoteReading | null;
      warnings: QualityWarning[];
      durationMs: number;
    };

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
  private readonly eventAnalyzer: LiveAnalyzer<PitchFeatures["data"]>;
  private eventActive = false;

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
    this.eventAnalyzer = pitchStrategy.createAnalyzer(sampleRate);
    this.tunerResampler = new StreamingResampler(sampleRate, ANALYSIS_SAMPLE_RATE);
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
        this.eventAnalyzer.reset();
        this.eventActive = true;
        events.push({ type: "sound-start" });
      } else if (output.type === "audio") {
        if (this.eventActive) this.eventAnalyzer.push(output.samples);
      } else {
        this.eventActive = false;
        // Ignore clicks and taps: they would only replace the last real note with noise.
        if (output.tooShort) continue;
        events.push(this.noteResult(output.durationMs));
      }
    }

    this.tunerTracker.push(this.tunerResampler.push(block), (frame) => this.onTunerFrame(frame));
    if (this.tuner && this.elapsedMs - this.lastValidFrameMs > TUNER_HOLD_MS) this.tuner = null;
    return events;
  }

  /** Finishes the current event's analysis and names its note. */
  private noteResult(durationMs: number): SessionEvent {
    const features = this.eventAnalyzer.finish() as PitchFeatures;
    return {
      type: "note",
      reading: identifyNote(features, this.options.a4Hz),
      warnings: uniqueWarnings(pitchWarnings(features.data), noiseWarning(features.data.stats, this.detector.state.noiseFloorDb)),
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
      if (output.type === "audio" && this.eventActive) this.eventAnalyzer.push(output.samples);
      if (output.type === "end") {
        this.eventActive = false;
        if (output.tooShort) continue;
        events.push(this.noteResult(output.durationMs));
      }
    }
    return events;
  }

  reset(): void {
    this.detector.reset();
    this.eventAnalyzer.reset();
    this.eventActive = false;
    this.tunerResampler.reset();
    this.tunerTracker.reset();
    this.recentFrames = [];
    this.lastValidFrameMs = -Infinity;
    this.tuner = null;
    this.elapsedMs = 0;
  }
}
