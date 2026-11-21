"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { recomputeFeaturesBatch } from "../actions";

/**
 * Shown when some references lack features from the current engine version
 * (after an algorithm update, or a failed import). Recomputes in small
 * batches with progress, so each request stays short.
 */
export function RecomputePanel({ outdatedCount }: { outdatedCount: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (outdatedCount === 0 && !running && done === 0) return null;

  async function run() {
    setRunning(true);
    setError(null);
    let processed = 0;
    let failures: string[] = [];
    for (;;) {
      const result = await recomputeFeaturesBatch(5, failures);
      if (!result.ok) {
        setError(result.message);
        break;
      }
      processed += result.value.processed;
      failures = [...failures, ...result.value.failed];
      setDone(processed);
      setFailed(failures);
      if (result.value.remaining === 0 || result.value.processed + result.value.failed.length === 0) break;
    }
    setRunning(false);
    router.refresh();
  }

  return (
    <Alert tone={failed.length ? "warning" : "info"} title="Reference features need updating">
      <div className="flex flex-col gap-3">
        <p>
          {outdatedCount === 1 ? "1 reference lacks" : `${outdatedCount} references lack`} features from the current analysis version, so{" "}
          {outdatedCount === 1 ? "it can" : "they can"}&apos;t be compared until recomputed.
        </p>
        {(running || done > 0) && (
          <p role="status">
            Recomputed {done}
            {failed.length > 0 && `, ${failed.length} failed (see the server log)`}.
          </p>
        )}
        {error && <p className="text-danger">{error}</p>}
        <Button variant="secondary" size="sm" className="self-start" onClick={() => void run()} disabled={running}>
          <RefreshCw aria-hidden className={running ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
          {running ? "Recomputing…" : "Recompute features"}
        </Button>
      </div>
    </Alert>
  );
}
