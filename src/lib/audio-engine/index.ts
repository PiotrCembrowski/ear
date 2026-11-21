/**
 * Public API of the audio engine. Pure TypeScript: safe to import from a Web
 * Worker, from Node (server, scripts, tests) and from React code (types).
 */
export * from "./constants";
export * from "./types";
export { midiToHz, hzToMidi, midiToNoteName, midiToSafeNoteName, nearestNote, parseNote, type NearestNote } from "./notes";
export { decodeWav, encodeWav16, WavFormatError, type WavInfo } from "./wav";
export { resample, StreamingResampler } from "./resampler";
export { SoundEventDetector, detectEvents, DEFAULT_DETECTOR_OPTIONS, type DetectorOptions, type DetectorOutput, type DetectorState } from "./event-detector";
export { levelWarnings, noiseWarning, uniqueWarnings } from "./quality";
export { StrategyRegistry, defaultRegistry } from "./registry";
export {
  analyzeReferenceWav,
  extractReferenceFeatures,
  mainEvent,
  REFERENCE_AUDIO_LIMITS,
  ReferenceAudioError,
  type ReferenceAnalysis,
  type ReferenceExtraction,
} from "./reference-features";
export {
  pitchStrategy,
  identifyNote,
  pitchConfidence,
  centsToScore,
  PITCH_STRATEGY_ID,
  PITCH_STRATEGY_VERSION,
  type PitchFeatures,
  type NoteReading,
} from "./strategies/pitch";
export { timbreStrategy, TIMBRE_STRATEGY_ID, TIMBRE_STRATEGY_VERSION, TIMBRE_CALIBRATION, type TimbreFeatures } from "./strategies/timbre";
export { rankClosest, type ClosestCandidate, type ClosestMatch, type ClosestResult } from "./closest";
export { ListeningSession, type ListeningMode, type SessionEvent, type SessionOptions, type SessionSnapshot, type TunerReading } from "./listening-session";
