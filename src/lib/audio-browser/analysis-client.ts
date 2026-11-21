/**
 * Creates the analysis worker. The `new Worker(new URL(..., import.meta.url))`
 * form must stay literal: it is how Next.js (Turbopack) finds the worker file
 * and bundles it, with its engine imports, as a separate script.
 */
export function createAnalysisWorker(): Worker {
  return new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module", name: "soundmatch-analysis" });
}
