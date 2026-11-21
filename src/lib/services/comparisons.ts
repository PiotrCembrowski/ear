import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComparisonMode, Database, Json } from "@/lib/supabase/database.types";
import { ServiceError } from "./errors";
import { sanitizeSearchText } from "./references";

/**
 * History (comparisons). Reads and deletes run as the user (RLS: own rows
 * only). Inserts use the server-only secret-key client, because users have no
 * INSERT grant: only POST /api/comparisons may write, after validating.
 */

type Client = SupabaseClient<Database>;

export type ComparisonListItem = {
  id: string;
  mode: ComparisonMode;
  title: string;
  score: number | null;
  strategyId: string;
  algorithmVersion: string;
  referenceSoundId: string | null;
  createdAt: string;
};

export type ComparisonDetail = ComparisonListItem & { result: Json; instrumentId: string | null };

export async function insertComparison(
  adminClient: Client,
  row: {
    userId: string;
    mode: ComparisonMode;
    referenceSoundId: string | null;
    instrumentId: string | null;
    strategyId: string;
    algorithmVersion: string;
    score: number | null;
    title: string;
    result: Json;
  },
): Promise<string> {
  const { data, error } = await adminClient
    .from("comparisons")
    .insert({
      user_id: row.userId,
      mode: row.mode,
      reference_sound_id: row.referenceSoundId,
      instrument_id: row.instrumentId,
      strategy_id: row.strategyId,
      algorithm_version: row.algorithmVersion,
      score: row.score,
      title: row.title,
      result: row.result,
      computed_on: "client",
    })
    .select("id")
    .single();
  if (error) throw new ServiceError("Could not save to history", error);
  return data.id;
}

/** Counts one history write for the CURRENT user; false when over the limit. */
export async function consumeHistoryQuota(userClient: Client, max: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await userClient.rpc("consume_rate_limit", { p_bucket: "history", p_max: max, p_window_seconds: windowSeconds });
  if (error) throw new ServiceError("Could not check the rate limit", error);
  return data === true;
}

const LIST_COLUMNS = "id, mode, title, score, strategy_id, algorithm_version, reference_sound_id, created_at";

type Row = {
  id: string;
  mode: ComparisonMode;
  title: string;
  score: number | string | null;
  strategy_id: string;
  algorithm_version: string;
  reference_sound_id: string | null;
  created_at: string;
};

function toItem(row: Row): ComparisonListItem {
  return {
    id: row.id,
    mode: row.mode,
    title: row.title,
    // numeric(5,2) can arrive as a string from PostgREST.
    score: row.score === null ? null : Number(row.score),
    strategyId: row.strategy_id,
    algorithmVersion: row.algorithm_version,
    referenceSoundId: row.reference_sound_id,
    createdAt: row.created_at,
  };
}

export async function listComparisons(
  userClient: Client,
  options: { query?: string; mode?: ComparisonMode; page?: number; pageSize?: number },
): Promise<{ items: ComparisonListItem[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);
  const page = Math.max(options.page ?? 1, 1);
  let query = userClient.from("comparisons").select(LIST_COLUMNS, { count: "exact" });
  if (options.mode) query = query.eq("mode", options.mode);
  const text = sanitizeSearchText(options.query ?? "");
  if (text) query = query.ilike("title", `%${text}%`);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw new ServiceError("Could not load history", error);
  return { items: (data as Row[]).map(toItem), total: count ?? 0, page, pageSize };
}

export async function getComparison(userClient: Client, id: string): Promise<ComparisonDetail | null> {
  const { data, error } = await userClient.from("comparisons").select(`${LIST_COLUMNS}, result, instrument_id`).eq("id", id).maybeSingle();
  if (error) throw new ServiceError("Could not load the comparison", error);
  if (!data) return null;
  const row = data as Row & { result: Json; instrument_id: string | null };
  return { ...toItem(row), result: row.result, instrumentId: row.instrument_id };
}

/** Deletes one of the user's own history entries (RLS refuses anyone else's). No files exist for it. */
export async function deleteComparison(userClient: Client, id: string): Promise<boolean> {
  const { data, error } = await userClient.from("comparisons").delete().eq("id", id).select("id");
  if (error) throw new ServiceError("Could not delete the comparison", error);
  return (data?.length ?? 0) > 0;
}
