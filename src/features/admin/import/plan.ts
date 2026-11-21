/**
 * Bulk-import planning: what will happen to each dropped file, BEFORE
 * anything is saved. Pure functions (tested), used by the import wizard.
 */
import { REFERENCE_LIMITS } from "@/lib/config/app-config";
import { fileExtension, isAudioFileName, noteCoverage, parseSampleFileName, type Coverage } from "@/lib/samples/sample-names";

export type ImportStatus =
  | "checking" // name is fine; waiting for the decode check
  | "ok"
  | "duplicate"
  | "invalid-name"
  | "unsupported-format"
  | "decode-failure"
  // during and after the import:
  | "importing"
  | "imported"
  | "failed";

export type ImportRow = {
  key: string;
  fileName: string;
  sizeBytes: number;
  midi: number | null;
  noteName: string | null;
  velocity: number | null;
  status: ImportStatus;
  /** Why, in plain words (for statuses other than ok). */
  detail: string | null;
  durationMs: number | null;
  /** After import: the note the engine heard, when it differs from the file name. */
  detectedNote: string | null;
};

export type InstrumentRange = { name: string; midiMin: number; midiMax: number; expectedNoteCount: number };

export const STATUS_LABELS: Record<ImportStatus, string> = {
  checking: "Checking…",
  ok: "Ready",
  duplicate: "Duplicate",
  "invalid-name": "Invalid name",
  "unsupported-format": "Unsupported format",
  "decode-failure": "Decode failure",
  importing: "Importing…",
  imported: "Imported",
  failed: "Failed",
};

const noteKey = (midi: number, velocity: number | null) => `${midi}:${velocity ?? ""}`;

/**
 * Classifies files by name and type. `existingKeys` are "midi:velocity" keys
 * already stored for this instrument variant.
 */
export function planImport(
  files: Array<{ name: string; size: number }>,
  instrument: InstrumentRange,
  existingKeys: ReadonlySet<string>,
): ImportRow[] {
  const seen = new Set<string>();
  return files.map((file, index) => {
    const row: ImportRow = {
      key: `${index}:${file.name}`,
      fileName: file.name,
      sizeBytes: file.size,
      midi: null,
      noteName: null,
      velocity: null,
      status: "checking",
      detail: null,
      durationMs: null,
      detectedNote: null,
    };
    if (!isAudioFileName(file.name)) {
      return { ...row, status: "unsupported-format", detail: `“.${fileExtension(file.name) || "?"}” files aren't audio this importer can read.` };
    }
    if (file.size > REFERENCE_LIMITS.maxImportFileBytes) {
      return { ...row, status: "unsupported-format", detail: "The file is larger than 50 MB." };
    }
    const parsed = parseSampleFileName(file.name);
    if (!parsed.ok) {
      return {
        ...row,
        status: "invalid-name",
        detail: parsed.reason === "ambiguous-note" ? "The name mentions more than one note." : "No note found in the name (e.g. A4, As4, Bb4 or a MIDI number).",
      };
    }
    const withNote = { ...row, midi: parsed.midi, noteName: parsed.noteName, velocity: parsed.velocity };
    if (parsed.midi < instrument.midiMin || parsed.midi > instrument.midiMax) {
      return { ...withNote, status: "invalid-name", detail: `${parsed.noteName} is outside the ${instrument.name.toLowerCase()}'s range.` };
    }
    const key = noteKey(parsed.midi, parsed.velocity);
    if (existingKeys.has(key)) return { ...withNote, status: "duplicate", detail: "This note is already in the library for this variant." };
    if (seen.has(key)) return { ...withNote, status: "duplicate", detail: "Another file in this batch has the same note and velocity." };
    seen.add(key);
    return withNote;
  });
}

/** Coverage after the import: notes already stored plus the files that are ready. */
export function plannedCoverage(rows: ImportRow[], instrument: InstrumentRange, existingMidi: Iterable<number>): Coverage {
  const incoming = rows.filter((r) => (r.status === "ok" || r.status === "checking" || r.status === "imported") && r.midi !== null).map((r) => r.midi!);
  return noteCoverage(instrument, [...existingMidi, ...incoming]);
}

export function countByStatus(rows: ImportRow[]): Partial<Record<ImportStatus, number>> {
  const counts: Partial<Record<ImportStatus, number>> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}
