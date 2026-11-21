/**
 * Engine-wide constants. Everything the engine measures is done at ONE
 * analysis sample rate, whatever the microphone or file uses, so that live
 * input and stored reference features are always comparable.
 */

/**
 * 22,050 Hz: half of CD rate. Its Nyquist frequency (11,025 Hz) is well above
 * the top piano note (C8 = 4,186 Hz) and covers the frequency range that
 * matters for timbre, while halving the work compared with 44.1/48 kHz.
 */
export const ANALYSIS_SAMPLE_RATE = 22_050;

/** A sound event is cut off after this long; longer sounds are truncated (with a warning). */
export const MAX_EVENT_MS = 5_000;

/** Shorter sound events are reported as "too short" (a click, a tap). */
export const MIN_EVENT_MS = 80;

/** Default concert pitch used when the caller doesn't provide one. */
export const DEFAULT_A4_HZ = 440;

/** dBFS value used for digital silence instead of -Infinity. */
export const SILENCE_DB = -120;
