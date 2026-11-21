/**
 * Closest match: rank all samples of an instrument against one sound.
 *
 * Pitched instruments (piano, guitar): the PITCH score ranks candidates (how
 * many cents the input is from each sample's measured pitch). Several
 * samples of the same note (velocity layers, variants) score almost the same
 * on pitch, so among candidates within 1 point of each other the TIMBRE
 * score breaks the tie (it hears loud vs soft, bright vs dark).
 *
 * Unpitched instruments (or samples without pitch features): timbre ranks.
 *
 * Only features are compared; the reference audio itself is never needed.
 */
import { centsBetween, round } from "./math";
import { levelWarnings, uniqueWarnings, warning } from "./quality";
import { identifyNote, pitchStrategy, pitchWarnings, type PitchFeatures } from "./strategies/pitch";
import { timbreStrategy, type TimbreFeatures } from "./strategies/timbre";
import type { Characteristic, FeatureSet, QualityWarning } from "./types";

export type ClosestCandidate = {
  id: string;
  pitch?: FeatureSet;
  timbre?: FeatureSet;
};

export type ClosestMatch = {
  id: string;
  /** Heuristic similarity 0–100 (the primary strategy's score). */
  score: number;
  /** Cents from the candidate's measured pitch (pitch ranking only). */
  cents: number | null;
  /** Timbre score, when it was used to break a tie. */
  timbreScore: number | null;
};

export type ClosestResult = {
  strategyId: "pitch" | "timbre";
  algorithmVersion: string;
  matches: ClosestMatch[];
  /** How many candidates were compared. */
  compared: number;
  warnings: QualityWarning[];
  characteristics: Characteristic[];
};

/** Candidates within this many points on pitch are separated by timbre. */
const TIE_POINTS = 1;
/** At most this many candidates get the (slower) timbre comparison. */
const MAX_TIEBREAK = 24;

export function rankClosest(
  input: { pitch?: FeatureSet; timbre?: FeatureSet },
  candidates: ClosestCandidate[],
  options: { primary: "pitch" | "timbre"; a4Hz?: number; limit?: number },
): ClosestResult {
  const limit = options.limit ?? 5;
  if (options.primary === "pitch") return rankByPitch(input, candidates, limit, options.a4Hz);
  return rankByTimbre(input, candidates, limit);
}

function rankByPitch(input: { pitch?: FeatureSet; timbre?: FeatureSet }, candidates: ClosestCandidate[], limit: number, a4Hz?: number): ClosestResult {
  const inputPitch = input.pitch as PitchFeatures | undefined;
  const base = { strategyId: "pitch" as const, algorithmVersion: pitchStrategy.version };
  if (!inputPitch) return { ...base, matches: [], compared: 0, warnings: [warning("no_clear_pitch")], characteristics: [] };
  const reading = identifyNote(inputPitch, a4Hz);
  const warnings = uniqueWarnings(pitchWarnings(inputPitch.data));
  const characteristics = reading?.characteristics ?? [];
  if (inputPitch.data.f0Hz === null) return { ...base, matches: [], compared: 0, warnings, characteristics };

  const scored = candidates
    .filter((c) => c.pitch && (c.pitch as PitchFeatures).data.f0Hz !== null)
    .map((c) => {
      const refHz = (c.pitch as PitchFeatures).data.f0Hz!;
      return {
        candidate: c,
        score: round(pitchStrategy.compare(inputPitch, c.pitch as PitchFeatures).score, 1),
        cents: round(centsBetween(inputPitch.data.f0Hz!, refHz), 1),
        timbreScore: null as number | null,
      };
    })
    .sort((a, b) => b.score - a.score || Math.abs(a.cents) - Math.abs(b.cents));

  // Tie-break near the top with timbre (velocity layers of the same note).
  const top = scored[0]?.score ?? 0;
  if (input.timbre) {
    for (const entry of scored.filter((s) => s.score >= top - TIE_POINTS).slice(0, MAX_TIEBREAK)) {
      if (entry.candidate.timbre) {
        entry.timbreScore = timbreStrategy.compare(input.timbre as TimbreFeatures, entry.candidate.timbre as TimbreFeatures).score;
      }
    }
    scored.sort((a, b) => {
      const tied = Math.abs(a.score - b.score) < TIE_POINTS;
      if (tied && a.timbreScore !== null && b.timbreScore !== null) return b.timbreScore - a.timbreScore;
      return b.score - a.score || Math.abs(a.cents) - Math.abs(b.cents);
    });
  }

  return {
    ...base,
    matches: scored.slice(0, limit).map((s) => ({ id: s.candidate.id, score: s.score, cents: s.cents, timbreScore: s.timbreScore })),
    compared: scored.length,
    warnings,
    characteristics,
  };
}

function rankByTimbre(input: { timbre?: FeatureSet }, candidates: ClosestCandidate[], limit: number): ClosestResult {
  const base = { strategyId: "timbre" as const, algorithmVersion: timbreStrategy.version };
  const inputTimbre = input.timbre as TimbreFeatures | undefined;
  if (!inputTimbre) return { ...base, matches: [], compared: 0, warnings: [], characteristics: [] };
  const scored = candidates
    .filter((c) => c.timbre)
    .map((c) => ({ id: c.id, score: timbreStrategy.compare(inputTimbre, c.timbre as TimbreFeatures).score, cents: null, timbreScore: null }))
    .sort((a, b) => b.score - a.score);
  const first = scored.length ? timbreStrategy.compare(inputTimbre, candidates.find((c) => c.id === scored[0]!.id)!.timbre as TimbreFeatures) : null;
  return {
    ...base,
    matches: scored.slice(0, limit),
    compared: scored.length,
    warnings: uniqueWarnings(levelWarnings(inputTimbre.data.stats)),
    characteristics: first?.characteristics ?? [],
  };
}
