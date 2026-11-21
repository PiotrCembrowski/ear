"use client";

import { Check, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { ClosestResultView } from "@/features/comparison/components/closest-result-view";
import { ComparisonResultView } from "@/features/comparison/components/comparison-result-view";
import type { ListenController, ListenState, SaveState } from "../listen-controller";

/** Shows whether the result reached history, with a way to save manually when it didn't. */
export function SaveStatus({ save, sequence, onSave }: { save: SaveState; sequence: number; onSave: () => void }) {
  if (save.status === "idle" || !("sequence" in save) || save.sequence !== sequence) return null;
  if (save.status === "saving") {
    return (
      <p role="status" className="flex items-center gap-2 text-xs text-ink-muted">
        <Spinner className="size-3" /> Saving to history…
      </p>
    );
  }
  if (save.status === "saved") {
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-success">
        <Check aria-hidden className="size-3.5" />
        <span className="text-ink-muted">
          Saved to your{" "}
          <Link href={`/history/${save.id}`} className="text-brand-strong underline">
            history
          </Link>
          .
        </span>
      </p>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <span>{save.message}</span>
      {!/Sign in/.test(save.message) && (
        <Button variant="ghost" size="sm" onClick={onSave}>
          Save this result
        </Button>
      )}
    </div>
  );
}

export function ResultPanel({ state, controller }: { state: ListenState; controller: ListenController }) {
  const result = state.lastResult;
  const listening = state.status === "listening";
  const actions = (
    <div className="flex flex-col items-end gap-2">
      <Button variant="secondary" onClick={() => void controller.tryAgain()}>
        <RotateCcw aria-hidden className="size-4" />
        Try again
      </Button>
      {result && <SaveStatus save={state.save} sequence={result.sequence} onSave={() => void controller.saveLastResult()} />}
    </div>
  );

  return (
    <Card aria-labelledby="result-heading" className="scroll-mt-6">
      <CardHeader>
        <CardTitle id="result-heading">Result</CardTitle>
      </CardHeader>
      <CardContent aria-live="polite">
        {!result ? (
          <p className="text-sm text-ink-muted">
            {listening ? "Play the sound now. The result appears here when it's ready." : "Start listening, then play the sound. The result appears here."}
          </p>
        ) : result.kind === "comparison" ? (
          <ComparisonResultView
            key={result.sequence}
            result={result.result}
            reference={{ name: result.reference.name, noteName: result.reference.noteName, isSynthetic: result.reference.isSynthetic }}
            actions={actions}
          />
        ) : (
          <ClosestResultView key={result.sequence} result={result.result} labels={result.labels} instrumentName={result.instrumentName} actions={actions} />
        )}
      </CardContent>
    </Card>
  );
}
