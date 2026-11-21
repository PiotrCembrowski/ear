/**
 * Recomputes reference features whose algorithm version is out of date
 * (e.g. after bumping a strategy's version), using the secret key.
 *
 *   npm run features:recompute            # recompute outdated references
 *   npm run features:recompute -- --dry   # only list them
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (e.g. from .env.local:
 * `node --env-file=.env.local` is used by the npm script). The admin page has
 * the same action as a button ("Recompute features").
 */
import { createClient } from "@supabase/supabase-js";
import { computeAndStoreFeatures, deleteStaleFeatures, listOutdatedReferenceIds } from "../src/lib/services/reference-features";
import type { Database } from "../src/lib/supabase/database.types";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (see .env.example).");
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const outdated = await listOutdatedReferenceIds(client);
  console.log(`${outdated.length} reference(s) need features from the current engine version.`);
  if (process.argv.includes("--dry") || outdated.length === 0) return;

  let failed = 0;
  for (const [index, id] of outdated.entries()) {
    try {
      const analysis = await computeAndStoreFeatures(client, id);
      console.log(`[${index + 1}/${outdated.length}] ${id}: ${analysis.features.map((f) => `${f.strategyId}@${f.algorithmVersion}`).join(", ")}`);
    } catch (error) {
      failed++;
      console.error(`[${index + 1}/${outdated.length}] ${id}: FAILED`, error instanceof Error ? error.message : error);
    }
  }
  if (failed === 0) {
    await deleteStaleFeatures(client);
    console.log("Done. Old-version features removed.");
  } else {
    console.log(`Done with ${failed} failure(s); old-version features were kept.`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
