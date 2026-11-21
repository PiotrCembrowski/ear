/**
 * Instrument-sample file names: parsing what libraries ship, and building
 * our own storage paths.
 *
 * Accepted note spellings (case-insensitive): "A#4", "As4", "Bb4",
 * "A-sharp-4", "B-flat-4", "C-1", or a bare MIDI number ("69", "069").
 * Velocity, optional: "v80" / "vel80" / "velocity80", or a dynamic marking
 * (pp, p, mp, mf, f, ff, fff) as in the University of Iowa samples.
 * Examples that parse:
 *   069_A4_v80.wav · A#4.wav · Piano.ff.Bb3.aiff · C4v8.flac (Salamander) ·
 *   piano-A-sharp-4-vel100.wav · 60.wav
 *
 * Storage paths never contain '#' (it breaks URLs); sharps are written "s":
 *   piano/grand-default/069_A4_v80.wav, piano/grand-default/070_As4.wav
 */
import { midiToNoteName, midiToSafeNoteName, parseNote } from "@/lib/audio-engine/notes";

export const AUDIO_EXTENSIONS = ["wav", "wave", "mp3", "ogg", "oga", "opus", "flac", "m4a", "aac", "mp4", "webm", "aif", "aiff"] as const;

/** MIDI velocity for common dynamic markings (approximate, as is conventional). */
const DYNAMIC_VELOCITY: Record<string, number> = { ppp: 16, pp: 33, p: 49, mp: 64, mf: 80, f: 96, ff: 112, fff: 127 };

export type ParsedSampleName =
  | { ok: true; midi: number; noteName: string; velocity: number | null }
  | { ok: false; reason: "no-note" | "ambiguous-note" };

export function fileExtension(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1]!.toLowerCase() : "";
}

export function isAudioFileName(fileName: string): boolean {
  return (AUDIO_EXTENSIONS as readonly string[]).includes(fileExtension(fileName));
}

/** Splits a file name (without extension) into tokens on _, space, dot and other separators. */
function tokens(baseName: string): string[] {
  return baseName.split(/[_\s.()[\]{},+]+/).filter(Boolean);
}

/** Pulls a velocity marking out of a token, or null. */
function velocityFromToken(token: string): number | null {
  const explicit = /^(?:v|vel|velocity)(\d{1,3})$/i.exec(token);
  if (explicit) {
    const value = Number(explicit[1]);
    return value >= 1 && value <= 127 ? value : null;
  }
  return DYNAMIC_VELOCITY[token.toLowerCase()] ?? null;
}

/**
 * Finds the note (and optional velocity) in a sample file name. Several
 * different notes in one name (e.g. "C4-to-E4.wav") are rejected as ambiguous.
 */
export function parseSampleFileName(fileName: string): ParsedSampleName {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "");
  const notes = new Set<number>();
  let velocity: number | null = null;

  const parts = tokens(base).flatMap((token) => {
    // Hyphenated spellings: "A-sharp-4", "B-flat-4" (possibly inside "piano-B-flat-4-vel100").
    const hyphenated = /([A-Ga-g])-(sharp|flat)-(-?\d)/i.exec(token);
    if (hyphenated) {
      const rest = (token.slice(0, hyphenated.index) + "-" + token.slice(hyphenated.index + hyphenated[0].length)).split("-");
      return [`${hyphenated[1]}-${hyphenated[2]}-${hyphenated[3]}`, ...rest.filter(Boolean)];
    }
    // Keep whole notes like "C-1"; otherwise split on hyphens ("piano-C4-vel100").
    return parseNote(token) !== null ? [token] : token.split("-").filter(Boolean);
  });

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    // Salamander style "C4v8" / "D#4v10": note immediately followed by a velocity.
    const glued = /^([A-Ga-g](?:#|s|b)?-?\d)v(\d{1,3})$/.exec(part);
    if (glued) {
      const midi = parseNote(glued[1]!);
      if (midi !== null) notes.add(midi);
      velocity = velocityFromToken(`v${glued[2]}`) ?? velocity;
      continue;
    }
    const v = velocityFromToken(part);
    if (v !== null) {
      velocity = v;
      continue;
    }
    // "velocity 64" / "vel 64": a keyword, then the number as a separate token.
    if (/^(?:v|vel|velocity)$/i.test(part) && /^\d{1,3}$/.test(parts[i + 1] ?? "")) {
      const value = Number(parts[i + 1]);
      if (value >= 1 && value <= 127) velocity = value;
      i++;
      continue;
    }
    // Bare numbers count as MIDI only when they look like one (2–3 digits, ≤ 127).
    if (/^\d+$/.test(part) && (part.length < 2 || part.length > 3)) continue;
    const midi = parseNote(part);
    if (midi !== null) notes.add(midi);
  }

  if (notes.size === 0) return { ok: false, reason: "no-note" };
  if (notes.size > 1) return { ok: false, reason: "ambiguous-note" };
  const midi = [...notes][0]!;
  return { ok: true, midi, noteName: midiToNoteName(midi), velocity };
}

/** Variant slugs, e.g. "grand-default". */
export function isValidVariant(variant: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(variant) && variant.length <= 60;
}

/** piano/grand-default/069_A4_v80.wav (velocity part omitted when there is none). */
export function sampleStoragePath(instrumentSlug: string, variant: string, midi: number, velocity: number | null): string {
  const note = midiToSafeNoteName(midi).replace("-", "m"); // C-1 → Cm1 (no '-' ambiguity)
  const velocityPart = velocity === null ? "" : `_v${velocity}`;
  return `${instrumentSlug}/${variant}/${String(midi).padStart(3, "0")}_${note}${velocityPart}.wav`;
}

/** Path for a general (non-instrument) reference: sounds/<category>/<id>.wav */
export function soundStoragePath(categorySlug: string, id: string): string {
  return `sounds/${categorySlug}/${id}.wav`;
}

/** Human-readable reference name for an instrument sample. */
export function sampleDisplayName(instrumentName: string, midi: number, variant: string, velocity: number | null): string {
  return `${instrumentName} ${midiToNoteName(midi)} · ${variant}${velocity === null ? "" : ` · v${velocity}`}`;
}

export type Coverage = {
  expected: number;
  present: number;
  missing: number[];
  complete: boolean;
};

/** Which notes of an instrument's range are present (any velocity counts). */
export function noteCoverage(range: { midiMin: number; midiMax: number; expectedNoteCount: number }, presentMidi: Iterable<number>): Coverage {
  const present = new Set([...presentMidi].filter((m) => m >= range.midiMin && m <= range.midiMax));
  const missing: number[] = [];
  for (let m = range.midiMin; m <= range.midiMax; m++) if (!present.has(m)) missing.push(m);
  return { expected: range.expectedNoteCount, present: present.size, missing, complete: present.size >= range.expectedNoteCount };
}

/** Compacts missing notes into ranges for display: "A0–C1, E1, G#2–B2". */
export function formatNoteRanges(midiNotes: number[]): string {
  const sorted = [...midiNotes].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(i === j ? midiToNoteName(sorted[i]!) : `${midiToNoteName(sorted[i]!)}–${midiToNoteName(sorted[j]!)}`);
    i = j + 1;
  }
  return parts.join(", ");
}
