import { z } from "zod";

/**
 * What the browser may send to POST /api/comparisons. Results are computed
 * on the user's device, so everything here is treated as untrusted input:
 * strict shapes (unknown keys rejected), finite numbers in range, bounded
 * text and array lengths. The server adds the user, reference snapshot and
 * title itself. No audio can be represented in this schema.
 */

const finite = z.number().refine(Number.isFinite, "Must be a finite number.");
const score = finite.min(0).max(100);
const shortText = (max: number) => z.string().max(max);
const series = (max: number) => z.array(finite).max(max);

export const warningSchema = z.strictObject({
  code: z.enum([
    "too_quiet",
    "clipping",
    "too_short",
    "truncated",
    "background_noise",
    "no_clear_pitch",
    "multiple_notes",
    "unstable_pitch",
    "octave_error",
  ]),
  message: shortText(300),
});

const characteristicSchema = z.strictObject({
  id: z.enum(["pitch", "note", "duration", "loudness", "peak", "brightness", "stability"]),
  label: shortText(40),
  value: finite,
  unit: shortText(12),
  display: shortText(60),
});

const strategyVersion = {
  strategyId: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  algorithmVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
};

/** A ComparisonResult (compare mode), as produced by the engine. */
export const comparisonResultSchema = z.strictObject({
  ...strategyVersion,
  score,
  explanation: shortText(800),
  breakdown: z
    .array(z.strictObject({ id: shortText(32), label: shortText(60), score, weight: finite.min(0).max(1), detail: shortText(200) }))
    .max(10),
  characteristics: z.array(characteristicSchema).max(10),
  warnings: z.array(warningSchema).max(10),
  visuals: z.strictObject({
    pitchTrack: z.strictObject({ timeMs: series(128), cents: series(128) }).optional(),
    spectrum: z.strictObject({ bandHz: series(64), inputDb: series(64), referenceDb: series(64) }).optional(),
    envelope: z.strictObject({ inputDb: series(64), referenceDb: series(64) }).optional(),
  }),
});

/** A closest-match ranking (closest mode). */
export const closestResultSchema = z.strictObject({
  strategyId: z.enum(["pitch", "timbre"]),
  algorithmVersion: strategyVersion.algorithmVersion,
  matches: z
    .array(z.strictObject({ id: z.uuid(), score, cents: finite.min(-2400).max(2400).nullable(), timbreScore: score.nullable() }))
    .max(5),
  compared: z.number().int().min(0).max(10_000),
  warnings: z.array(warningSchema).max(10),
  characteristics: z.array(characteristicSchema).max(10),
});

/** One identified note (identify mode, saved with "Save this note"). */
export const noteResultSchema = z.strictObject({
  name: z.string().regex(/^[A-G]#?-?\d$/),
  midi: z.number().int().min(0).max(127),
  hz: finite.min(10).max(10_000),
  cents: finite.min(-50).max(50),
  confidence: z.strictObject({ value: finite.min(0).max(1), level: z.enum(["high", "medium", "low"]) }),
  warnings: z.array(warningSchema).max(10),
  durationMs: finite.min(0).max(60_000),
});

export const recordComparisonSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("compare"), trigger: z.enum(["auto", "manual"]), referenceId: z.uuid(), result: comparisonResultSchema }),
  z.strictObject({
    mode: z.literal("closest"),
    trigger: z.enum(["auto", "manual"]),
    instrumentId: z.uuid(),
    variant: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60).nullable(),
    result: closestResultSchema,
  }),
  z.strictObject({ mode: z.literal("identify"), trigger: z.literal("manual"), result: noteResultSchema }),
]);

export type RecordComparisonInput = z.infer<typeof recordComparisonSchema>;

/** Requests larger than this are refused before parsing. Results are normally 2–8 KB. */
export const MAX_COMPARISON_REQUEST_BYTES = 32 * 1024;

/**
 * Shapes stored in comparisons.result (written only by recordComparison).
 * Read back for the history pages; anything that doesn't parse is shown as
 * "can't be displayed" rather than crashing the page.
 */
const referenceSnapshotSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  noteName: z.string().nullable(),
  isSynthetic: z.boolean(),
});

export const storedResultSchema = z.discriminatedUnion("mode", [
  comparisonResultSchema.extend({ schema: z.literal(1), mode: z.literal("compare"), reference: referenceSnapshotSchema }),
  closestResultSchema.extend({
    schema: z.literal(1),
    mode: z.literal("closest"),
    instrument: z.strictObject({ id: z.string(), name: z.string() }),
    variant: z.string().nullable(),
    matches: z
      .array(
        z.object({
          id: z.string(),
          score,
          cents: finite.nullable(),
          timbreScore: score.nullable(),
          name: z.string().optional(),
          noteName: z.string().optional(),
          velocity: z.number().nullable().optional(),
          variant: z.string().optional(),
          isSynthetic: z.boolean().optional(),
        }),
      )
      .max(5),
  }),
  noteResultSchema.extend({ schema: z.literal(1), mode: z.literal("identify") }),
]);

export type StoredResult = z.infer<typeof storedResultSchema>;
