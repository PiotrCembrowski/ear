/**
 * Sound-event detector: decides automatically when a sound starts and ends,
 * so the user just plays and the app knows what to analyse.
 *
 * It works at the INPUT sample rate on short frames (≈ 11.6 ms) and needs no
 * resampling. Per frame it measures:
 *   - level: RMS in dBFS;
 *   - spectral flux: how much the (log-compressed) spectrum grew since the
 *     previous frame. A new note makes new frequencies appear suddenly, so
 *     flux spikes even when the overall level doesn't change (legato).
 *
 * Decisions:
 *   - Warm-up: the first 250 ms only measure the background (no events yet),
 *     so the detector learns the room before it starts listening for sounds.
 *   - Noise floor: 10th percentile of the level over the last 3 s of
 *     non-event frames (adapts to the room; ignores occasional bumps).
 *   - Start: level ≥ floor + sensitivity for 2 consecutive frames (≈ 23 ms,
 *     so a single click doesn't trigger). Audio from 100 ms before the onset
 *     ("pre-roll") is included so the attack of the note is never lost.
 *   - End: level < start threshold − 4 dB (hysteresis, so a decaying note
 *     doesn't flicker on and off) for 200 ms ("hangover"); or 5 s reached.
 *   - Split: a flux spike well above its median SO FAR IN THIS EVENT while a
 *     sound is playing ends the current event and starts a new one (two notes played
 *     back to back become two events). A spike is only provisional for 3
 *     frames (≈ 35 ms): if the level then drops away, it was the sound
 *     stopping (an abrupt stop also smears the spectrum), not a new note.
 *
 * Privacy: the only raw audio kept is a ~150 ms ring buffer for the pre-roll.
 * Event audio is handed out frame by frame ("audio" outputs) for the analyzer
 * to turn into features immediately.
 */
import { MAX_EVENT_MS, MIN_EVENT_MS } from "./constants";
import { amplitudeToDb, clamp, median, percentile } from "./math";
import { SpectrumAnalyzer } from "./spectrum";

export type DetectorOptions = {
  /** dB above the noise floor needed to start an event (UI "sensitivity"; lower = more sensitive). */
  sensitivityDb: number;
  preRollMs: number;
  hangoverMs: number;
  minEventMs: number;
  maxEventMs: number;
  /**
   * Live microphones: ignore frames of pure digital silence (below −100 dBFS).
   * Real mics never produce them, except for a moment while starting up or
   * when muted; learning the background from them would make the gate far
   * too sensitive, so the room's own hiss would count as a "sound".
   * Off for files: reference files are deliberately padded with silence.
   */
  ignoreDigitalSilence: boolean;
};

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  sensitivityDb: 12,
  preRollMs: 100,
  hangoverMs: 200,
  minEventMs: MIN_EVENT_MS,
  maxEventMs: MAX_EVENT_MS,
  ignoreDigitalSilence: false,
};

export type EventEndReason = "silence" | "max_duration" | "new_onset" | "flush";

export type DetectorOutput =
  | { type: "start"; onsetSample: number; audioStartSample: number }
  | { type: "audio"; samples: Float32Array }
  | {
      type: "end";
      onsetSample: number;
      /** First sample of the quiet stretch (or of the next note, or where it was cut). */
      offsetSample: number;
      reason: EventEndReason;
      durationMs: number;
      tooShort: boolean;
    };

export type DetectorState = {
  levelDb: number;
  noiseFloorDb: number;
  thresholdDb: number;
  active: boolean;
  /** ms since the current event's onset (0 when idle). */
  eventMs: number;
};

/** Analysis frame ≈ 11.6 ms (256 samples at 22,050 Hz), scaled to the input rate. */
const FRAME_SECONDS = 256 / 22050;
const NOISE_HISTORY_SECONDS = 3;
const NOISE_PERCENTILE = 10;
/** Before any history exists, assume a quiet room. */
const INITIAL_NOISE_FLOOR_DB = -70;
/** Floor limits: digital silence shouldn't make the gate hair-trigger; a loud room can't hide sounds. */
const MIN_NOISE_FLOOR_DB = -80;
const MAX_NOISE_FLOOR_DB = -30;
const HYSTERESIS_DB = 4;
/** Below this a frame is digital silence (16-bit audio's own noise is ≈ −98 dBFS). */
const DIGITAL_SILENCE_DB = -100;
const WARMUP_SECONDS = 0.25;
const START_FRAMES = 2;
/** Flux split rules: spike ≥ 3× the recent median, not within 150 ms of the last onset. */
const FLUX_HISTORY_SECONDS = 0.5;
const FLUX_SPIKE_RATIO = 3;
const FLUX_MIN = 0.02;
const MIN_ONSET_GAP_MS = 150;
const SPLIT_CONFIRM_FRAMES = 3;

export class SoundEventDetector {
  readonly sampleRate: number;
  private options: DetectorOptions;
  private readonly frameSize: number;
  private readonly spectrum: SpectrumAnalyzer;
  private readonly magnitudes: Float64Array;
  private previousLogSpectrum: Float64Array;

  // Raw-sample ring: just enough for pre-roll + the flux FFT window.
  private readonly ring: Float32Array;
  private ringWrite = 0;
  /** Absolute index of the next sample to arrive. */
  private sampleCount = 0;
  /** Samples of the frame currently being collected. */
  private readonly pending: Float32Array;
  private pendingLength = 0;

  private readonly warmupFrames: number;
  private framesSeen = 0;
  private readonly levelHistory: number[] = [];
  private readonly fluxHistory: number[] = [];
  private noiseFloorDb = INITIAL_NOISE_FLOOR_DB;
  private lastLevelDb = -120;

  private active = false;
  private loudRun = 0;
  private quietRun = 0;
  private quietStartSample = 0;
  private onsetSample = 0;
  private lastOnsetSample = -Infinity;
  /** After a forced 5 s cut, wait for quiet before starting again. */
  private needsRearm = false;
  /** A possible new note being confirmed: where it would start, and frames seen since. */
  private splitCandidate: { startSample: number; frames: number } | null = null;

  constructor(sampleRate: number, options: Partial<DetectorOptions> = {}) {
    this.sampleRate = sampleRate;
    this.options = { ...DEFAULT_DETECTOR_OPTIONS, ...options };
    this.frameSize = Math.max(32, Math.round(sampleRate * FRAME_SECONDS));
    this.warmupFrames = Math.ceil(WARMUP_SECONDS / FRAME_SECONDS);
    let fftSize = 64;
    while (fftSize < this.frameSize * 2) fftSize *= 2;
    this.spectrum = new SpectrumAnalyzer(fftSize);
    this.magnitudes = new Float64Array(this.spectrum.binCount);
    this.previousLogSpectrum = new Float64Array(this.spectrum.binCount);
    const preRollSamples = Math.round((this.options.preRollMs / 1000) * sampleRate);
    this.ring = new Float32Array(Math.max(preRollSamples + 2 * this.frameSize, fftSize) + this.frameSize);
    this.pending = new Float32Array(this.frameSize);
  }

  setSensitivity(sensitivityDb: number): void {
    this.options = { ...this.options, sensitivityDb };
  }

  /** True during the first 250 ms while the background level is being measured. */
  get calibrating(): boolean {
    return this.framesSeen < this.warmupFrames;
  }

  get state(): DetectorState {
    return {
      levelDb: this.lastLevelDb,
      noiseFloorDb: this.noiseFloorDb,
      thresholdDb: this.startThreshold(),
      active: this.active,
      eventMs: this.active ? this.samplesToMs(this.sampleCount - this.onsetSample) : 0,
    };
  }

  process(block: ArrayLike<number>): DetectorOutput[] {
    const outputs: DetectorOutput[] = [];
    let offset = 0;
    while (offset < block.length) {
      const take = Math.min(this.frameSize - this.pendingLength, block.length - offset);
      for (let i = 0; i < take; i++) this.pending[this.pendingLength + i] = block[offset + i]!;
      this.pendingLength += take;
      offset += take;
      if (this.pendingLength === this.frameSize) {
        this.processFrame(outputs);
        this.pendingLength = 0;
      }
    }
    return outputs;
  }

  /** Ends an event that is still running (e.g. the user pressed Stop, or the file ended). */
  flush(): DetectorOutput[] {
    const outputs: DetectorOutput[] = [];
    if (this.pendingLength > 0 && this.active) {
      const tail = this.pending.slice(0, this.pendingLength);
      this.writeRing(tail);
      this.sampleCount += tail.length;
      outputs.push({ type: "audio", samples: tail });
    }
    this.pendingLength = 0;
    if (this.splitCandidate) {
      outputs.push({ type: "audio", samples: this.readRing(this.splitCandidate.startSample, this.sampleCount) });
      this.splitCandidate = null;
    }
    if (this.active) outputs.push(this.endEvent(this.sampleCount, "flush"));
    return outputs;
  }

  reset(): void {
    this.ring.fill(0);
    this.ringWrite = 0;
    this.sampleCount = 0;
    this.pendingLength = 0;
    this.framesSeen = 0;
    this.levelHistory.length = 0;
    this.fluxHistory.length = 0;
    this.previousLogSpectrum.fill(0);
    this.noiseFloorDb = INITIAL_NOISE_FLOOR_DB;
    this.lastLevelDb = -120;
    this.active = false;
    this.loudRun = 0;
    this.quietRun = 0;
    this.lastOnsetSample = -Infinity;
    this.needsRearm = false;
    this.splitCandidate = null;
  }

  // -------------------------------------------------------------------------

  private startThreshold(): number {
    return this.noiseFloorDb + this.options.sensitivityDb;
  }

  private samplesToMs(samples: number): number {
    return (samples / this.sampleRate) * 1000;
  }

  private msToSamples(ms: number): number {
    return Math.round((ms / 1000) * this.sampleRate);
  }

  private writeRing(samples: ArrayLike<number>): void {
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.ringWrite] = samples[i]!;
      this.ringWrite = (this.ringWrite + 1) % this.ring.length;
    }
  }

  /** Copies absolute samples [from, to) out of the ring (must still be in it). */
  private readRing(from: number, to: number): Float32Array {
    const out = new Float32Array(Math.max(0, to - from));
    for (let s = from; s < to; s++) {
      const age = this.sampleCount - s; // 1 = most recent
      out[s - from] = this.ring[(this.ringWrite - age + this.ring.length * 2) % this.ring.length]!;
    }
    return out;
  }

  private spectralFlux(): number {
    // FFT over the latest fftSize samples (this frame plus history).
    const segment = this.readRing(this.sampleCount - this.spectrum.size, this.sampleCount);
    this.spectrum.magnitudes(segment, this.magnitudes);
    let flux = 0;
    for (let k = 1; k < this.magnitudes.length; k++) {
      // log(1 + γ|X|) compresses loud partials so quiet new ones still count.
      const logMagnitude = Math.log1p(100 * this.magnitudes[k]!);
      const rise = logMagnitude - this.previousLogSpectrum[k]!;
      if (rise > 0) flux += rise;
      this.previousLogSpectrum[k] = logMagnitude;
    }
    return flux / (this.magnitudes.length - 1);
  }

  private processFrame(outputs: DetectorOutput[]): void {
    const frame = this.pending;
    const frameStart = this.sampleCount;
    this.writeRing(frame);
    this.sampleCount += frame.length;

    let sumSquares = 0;
    for (let i = 0; i < frame.length; i++) sumSquares += frame[i]! * frame[i]!;
    const levelDb = amplitudeToDb(Math.sqrt(sumSquares / frame.length));
    this.lastLevelDb = levelDb;
    const flux = this.spectralFlux();
    const fluxMedian = this.fluxHistory.length ? median(this.fluxHistory) : 0;
    pushBounded(this.fluxHistory, flux, Math.round(FLUX_HISTORY_SECONDS / FRAME_SECONDS));

    const startThreshold = this.startThreshold();
    const endThreshold = startThreshold - HYSTERESIS_DB;

    if (!this.active && this.options.ignoreDigitalSilence && levelDb < DIGITAL_SILENCE_DB) return;
    this.framesSeen++;
    if (!this.active) {
      if (levelDb < endThreshold) this.needsRearm = false;
      if (!this.calibrating && !this.needsRearm && levelDb >= startThreshold) {
        this.loudRun++;
        if (this.loudRun >= START_FRAMES) {
          const onset = frameStart - (START_FRAMES - 1) * this.frameSize;
          this.startEvent(onset, outputs, this.msToSamples(this.options.preRollMs));
        }
      } else {
        this.loudRun = 0;
        // Only frames outside events teach the detector what "background" is.
        pushBounded(this.levelHistory, levelDb, Math.round(NOISE_HISTORY_SECONDS / FRAME_SECONDS));
        this.noiseFloorDb = clamp(percentile(this.levelHistory, NOISE_PERCENTILE), MIN_NOISE_FLOOR_DB, MAX_NOISE_FLOOR_DB);
      }
      return;
    }

    // Active event.
    if (this.splitCandidate) {
      this.splitCandidate.frames++;
      if (levelDb < endThreshold) {
        // The level fell away: the spike was the sound stopping. Give the held
        // frames back to the current event and carry on with end detection.
        outputs.push({ type: "audio", samples: this.readRing(this.splitCandidate.startSample, this.sampleCount) });
        this.splitCandidate = null;
        this.trackQuiet(levelDb, endThreshold, frameStart, frame.length, outputs);
      } else if (this.splitCandidate.frames >= SPLIT_CONFIRM_FRAMES) {
        const splitAt = this.splitCandidate.startSample;
        this.splitCandidate = null;
        outputs.push(this.endEvent(splitAt, "new_onset"));
        // The new event starts exactly at the spike: no pre-roll (that audio belonged to the previous note).
        this.startEvent(splitAt, outputs, 0);
      }
      return;
    }

    const sinceOnsetMs = this.samplesToMs(frameStart - this.lastOnsetSample);
    const isOnsetSpike =
      levelDb >= startThreshold && sinceOnsetMs >= MIN_ONSET_GAP_MS && flux > FLUX_MIN && flux > FLUX_SPIKE_RATIO * fluxMedian;
    if (isOnsetSpike) {
      // Hold this frame's audio until the split is confirmed or rejected.
      this.splitCandidate = { startSample: frameStart, frames: 1 };
      return;
    }

    outputs.push({ type: "audio", samples: frame.slice() });
    this.trackQuiet(levelDb, endThreshold, frameStart, frame.length, outputs);

    if (this.active && this.sampleCount - this.onsetSample >= this.msToSamples(this.options.maxEventMs)) {
      outputs.push(this.endEvent(this.sampleCount, "max_duration"));
      this.needsRearm = true;
    }
  }

  /** Ends the event once the level has stayed below the end threshold for the hangover time. */
  private trackQuiet(levelDb: number, endThreshold: number, frameStart: number, frameLength: number, outputs: DetectorOutput[]): void {
    if (levelDb < endThreshold) {
      if (this.quietRun === 0) this.quietStartSample = frameStart;
      this.quietRun += frameLength;
      if (this.quietRun >= this.msToSamples(this.options.hangoverMs)) {
        outputs.push(this.endEvent(this.quietStartSample, "silence"));
      }
    } else {
      this.quietRun = 0;
    }
  }

  private startEvent(onsetSample: number, outputs: DetectorOutput[], preRollSamples: number): void {
    const earliestInRing = this.sampleCount - this.ring.length + this.frameSize;
    const audioStart = Math.max(0, onsetSample - preRollSamples, earliestInRing);
    this.active = true;
    this.loudRun = 0;
    this.quietRun = 0;
    this.onsetSample = onsetSample;
    this.lastOnsetSample = onsetSample;
    // Judge flux spikes against this sound only: compared with the quiet frames
    // before it, ordinary noise or vibrato would look like a "new note".
    this.fluxHistory.length = 0;
    outputs.push({ type: "start", onsetSample, audioStartSample: audioStart });
    outputs.push({ type: "audio", samples: this.readRing(audioStart, this.sampleCount) });
  }

  private endEvent(offsetSample: number, reason: EventEndReason): DetectorOutput {
    this.active = false;
    this.loudRun = 0;
    this.quietRun = 0;
    const durationMs = this.samplesToMs(offsetSample - this.onsetSample);
    return {
      type: "end",
      onsetSample: this.onsetSample,
      offsetSample,
      reason,
      durationMs,
      tooShort: durationMs < this.options.minEventMs,
    };
  }
}

function pushBounded(list: number[], value: number, max: number): void {
  list.push(value);
  if (list.length > max) list.shift();
}

/** A complete event cut out of a clip (batch use: reference import, tests). */
export type DetectedEvent = {
  /** First sample of the event audio (onset minus pre-roll). */
  audioStartSample: number;
  onsetSample: number;
  offsetSample: number;
  reason: EventEndReason;
  durationMs: number;
  tooShort: boolean;
  /** Event audio including pre-roll. */
  samples: Float32Array;
};

/** Runs the detector over a whole clip and returns every event with its audio. */
export function detectEvents(samples: Float32Array, sampleRate: number, options: Partial<DetectorOptions> = {}, blockSize = 4096): DetectedEvent[] {
  const detector = new SoundEventDetector(sampleRate, options);
  const events: DetectedEvent[] = [];
  let parts: Float32Array[] = [];
  let audioStartSample = 0;
  const handle = (outputs: DetectorOutput[]) => {
    for (const output of outputs) {
      if (output.type === "start") {
        parts = [];
        audioStartSample = output.audioStartSample;
      } else if (output.type === "audio") parts.push(output.samples);
      else {
        const length = parts.reduce((n, p) => n + p.length, 0);
        const audio = new Float32Array(length);
        let offset = 0;
        for (const part of parts) {
          audio.set(part, offset);
          offset += part.length;
        }
        events.push({ ...output, audioStartSample, samples: audio });
        parts = [];
      }
    }
  };
  for (let offset = 0; offset < samples.length; offset += blockSize) handle(detector.process(samples.subarray(offset, offset + blockSize)));
  handle(detector.flush());
  return events;
}
