import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultRegistry, PITCH_STRATEGY_ID, PITCH_STRATEGY_VERSION } from "@/lib/audio-engine";
import { insertComparison, consumeHistoryQuota } from "@/lib/services/comparisons";
import { referenceMeta } from "@/lib/services/reference-features";
import { getReference, listInstruments, sampleSnapshots } from "@/lib/services/references";
import type { Database, Json } from "@/lib/supabase/database.types";
import { recordComparisonSchema } from "@/lib/validation/comparisons";

/**
 * Saves a result summary to the user's history. The browser computed the
 * result, so it is trusted ONLY for the user's own history; everything else
 * is checked or decided here:
 *   - shape and ranges (Zod), current strategy + version (registry);
 *   - the reference exists and this user may read it, and the registry would
 *     pick that strategy for it; closest-match ids are samples of that instrument;
 *   - the user id comes from the session; title and reference snapshot are built here;
 *   - automatic saves respect the user's "save history" setting;
 *   - a per-user rate limit (Postgres-backed).
 */

type Client = SupabaseClient<Database>;

export type RecordDeps = {
  userClient: Client;
  adminClient: Client;
  userId: string;
  saveHistory: boolean;
  rateLimit: { max: number; windowSeconds: number };
};

export type RecordOutcome =
  | { status: "saved"; id: string }
  | { status: "skipped"; reason: "history-off" }
  | { status: "rejected"; reason: "invalid" | "not-found" | "outdated" | "rate-limited"; message: string };

const reject = (reason: Exclude<RecordOutcome, { status: "saved" | "skipped" }>["reason"], message: string): RecordOutcome => ({
  status: "rejected",
  reason,
  message,
});

/** Stored results stay well under the 16 KB database limit. */
const MAX_STORED_BYTES = 15_000;

export async function recordComparison(deps: RecordDeps, body: unknown): Promise<RecordOutcome> {
  const parsed = recordComparisonSchema.safeParse(body);
  if (!parsed.success) return reject("invalid", "The result summary was not valid.");
  const input = parsed.data;
  if (input.trigger === "auto" && !deps.saveHistory) return { status: "skipped", reason: "history-off" };

  let row: Parameters<typeof insertComparison>[1];

  if (input.mode === "compare") {
    const { result } = input;
    if (!defaultRegistry.isCurrent(result.strategyId, result.algorithmVersion)) {
      return reject("outdated", "This result was made with an older version of the analysis. Reload the page and try again.");
    }
    const reference = await getReference(deps.userClient, input.referenceId);
    if (!reference) return reject("not-found", "That reference sound doesn't exist or isn't available to you.");
    if (defaultRegistry.pickFor(referenceMeta(reference)).id !== result.strategyId) return reject("invalid", "The result doesn't match this reference.");
    const note = result.characteristics.find((c) => c.id === "note")?.display.split(",")[0];
    row = {
      userId: deps.userId,
      mode: "compare",
      referenceSoundId: reference.id,
      instrumentId: reference.sample?.instrumentId ?? null,
      strategyId: result.strategyId,
      algorithmVersion: result.algorithmVersion,
      score: Math.round(result.score * 100) / 100,
      title: `${note ? `${note} vs ` : ""}${reference.name}`.slice(0, 200),
      result: {
        schema: 1,
        mode: "compare",
        ...result,
        reference: {
          id: reference.id,
          name: reference.name,
          category: reference.category.name,
          noteName: reference.sample?.noteName ?? null,
          isSynthetic: reference.isSynthetic,
        },
      } as unknown as Json,
    };
  } else if (input.mode === "closest") {
    const { result } = input;
    if (!defaultRegistry.isCurrent(result.strategyId, result.algorithmVersion)) {
      return reject("outdated", "This result was made with an older version of the analysis. Reload the page and try again.");
    }
    const instrument = (await listInstruments(deps.userClient)).find((i) => i.id === input.instrumentId);
    if (!instrument) return reject("not-found", "That instrument doesn't exist.");
    const snapshots = await sampleSnapshots(deps.userClient, instrument.id, result.matches.map((m) => m.id));
    if (snapshots.length !== new Set(result.matches.map((m) => m.id)).size) return reject("invalid", "Some matches aren't samples of this instrument.");
    const byId = new Map(snapshots.map((s) => [s.referenceId, s]));
    const best = result.matches[0] ? byId.get(result.matches[0].id) : undefined;
    row = {
      userId: deps.userId,
      mode: "closest",
      referenceSoundId: best?.referenceId ?? null,
      instrumentId: instrument.id,
      strategyId: result.strategyId,
      algorithmVersion: result.algorithmVersion,
      score: result.matches[0]?.score ?? 0,
      title: `Closest ${instrument.name.toLowerCase()} note: ${best ? best.name : "no match"}`.slice(0, 200),
      result: {
        schema: 1,
        mode: "closest",
        ...result,
        instrument: { id: instrument.id, name: instrument.name },
        variant: input.variant,
        matches: result.matches.map((m) => ({ ...m, ...byId.get(m.id) })),
      } as unknown as Json,
    };
  } else {
    const { result } = input;
    const cents = Math.round(result.cents);
    row = {
      userId: deps.userId,
      mode: "identify",
      referenceSoundId: null,
      instrumentId: null,
      strategyId: PITCH_STRATEGY_ID,
      algorithmVersion: PITCH_STRATEGY_VERSION,
      score: null,
      title: `Note ${result.name}, ${cents === 0 ? "in tune" : `${cents > 0 ? "+" : "−"}${Math.abs(cents)} cents`}`,
      result: { schema: 1, mode: "identify", ...result } as unknown as Json,
    };
  }

  if (JSON.stringify(row.result).length > MAX_STORED_BYTES) return reject("invalid", "The result summary is too large.");
  if (!(await consumeHistoryQuota(deps.userClient, deps.rateLimit.max, deps.rateLimit.windowSeconds))) {
    return reject("rate-limited", "You've saved a lot of results in a short time. Please wait a few minutes.");
  }
  return { status: "saved", id: await insertComparison(deps.adminClient, row) };
}
