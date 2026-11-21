/**
 * Musical notes. A note's canonical identity is its MIDI number
 * (21 = A0 … 69 = A4 … 108 = C8). Names and frequencies are derived from it.
 */
import { DEFAULT_A4_HZ } from "./constants";

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const LETTER_TO_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Equal-tempered frequency of a MIDI note: f = A4 · 2^((midi − 69) / 12). */
export function midiToHz(midi: number, a4Hz: number = DEFAULT_A4_HZ): number {
  return a4Hz * 2 ** ((midi - 69) / 12);
}

/** Fractional MIDI number for a frequency (69.5 = a quarter-tone above A4). */
export function hzToMidi(hz: number, a4Hz: number = DEFAULT_A4_HZ): number {
  return 69 + 12 * Math.log2(hz / a4Hz);
}

/** Display name with a sharp sign, e.g. 70 → "A#4", 60 → "C4", 0 → "C-1". */
export function midiToNoteName(midi: number): string {
  const pitchClass = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return `${SHARP_NAMES[pitchClass]}${octave}`;
}

/** URL/storage-safe name: '#' becomes 's', e.g. 70 → "As4" (a '#' would break URLs). */
export function midiToSafeNoteName(midi: number): string {
  return midiToNoteName(midi).replace("#", "s");
}

export type NearestNote = {
  midi: number;
  name: string;
  /** Equal-tempered frequency of that note at the given A4. */
  noteHz: number;
  /** How far the input is from that note, in cents (−50 … +50). Positive = sharp. */
  cents: number;
};

export function nearestNote(hz: number, a4Hz: number = DEFAULT_A4_HZ): NearestNote {
  const midiFloat = hzToMidi(hz, a4Hz);
  const midi = Math.round(midiFloat);
  return { midi, name: midiToNoteName(midi), noteHz: midiToHz(midi, a4Hz), cents: (midiFloat - midi) * 100 };
}

/**
 * Parses the note spellings found in sample-library file names:
 *   "A4", "A#4", "As4", "Bb4", "A-sharp-4", "B-flat-4", "C-1", or a bare MIDI number "69".
 * Returns the MIDI number, or null if the text isn't a note.
 */
export function parseNote(text: string): number | null {
  const token = text.trim();
  if (/^\d{1,3}$/.test(token)) {
    const midi = Number(token);
    return midi <= 127 ? midi : null;
  }
  const match = /^([A-Ga-g])(?:(#|♯|s|b|♭|-sharp-?|-flat-?)?)(-?\d)$/i.exec(token.replace(/_/g, "-"));
  if (!match) return null;
  const [, letter, accidentalRaw = "", octaveText] = match;
  const accidental = accidentalRaw.toLowerCase();
  let semitone = LETTER_TO_SEMITONE[letter!.toUpperCase()]!;
  if (accidental === "#" || accidental === "♯" || accidental === "s" || accidental.startsWith("-sharp")) semitone += 1;
  if (accidental === "b" || accidental === "♭" || accidental.startsWith("-flat")) semitone -= 1;
  const midi = (Number(octaveText) + 1) * 12 + semitone;
  return midi >= 0 && midi <= 127 ? midi : null;
}
