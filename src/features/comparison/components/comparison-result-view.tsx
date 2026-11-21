import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { ComparisonResult } from "@/lib/audio-engine/types";
import { HowToReadScore } from "./how-to-read";
import { ResultVisualsView } from "./result-visuals";
import { ScoreDisplay } from "./score-badge";
import { WarningList } from "./warning-list";

export type ReferenceLabel = { name: string; noteName?: string | null; isSynthetic?: boolean; categoryName?: string };

/** Full result of a one-to-one comparison: used live (Listen) and in history. */
export function ComparisonResultView({ result, reference, actions }: { result: ComparisonResult; reference?: ReferenceLabel; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs tracking-wide text-ink-subtle uppercase">Heuristic similarity score</p>
          <ScoreDisplay score={result.score} />
          {reference && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              vs <span className="text-ink">{reference.name}</span>
              {reference.isSynthetic && <Badge tone="warning">Synthetic test tone</Badge>}
            </p>
          )}
        </div>
        {actions}
      </div>

      <p className="text-sm leading-relaxed text-ink-muted">{result.explanation}</p>
      <WarningList warnings={result.warnings} />

      <section aria-label="Score breakdown" className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-ink">Breakdown</h4>
        <ul className="flex flex-col gap-3">
          {result.breakdown.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink">
                  {item.label}
                  {item.weight === 0 ? (
                    <span className="ml-2 text-xs text-ink-subtle">for context</span>
                  ) : (
                    <span className="ml-2 text-xs text-ink-subtle">{Math.round(item.weight * 100)}% of score</span>
                  )}
                </span>
                <span className="font-mono text-ink tabular-nums">{Math.round(item.score)}</span>
              </div>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
                role="meter"
                aria-label={item.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(item.score)}
              >
                <div className={item.weight === 0 ? "h-full bg-ink-subtle/50" : "h-full bg-series-1"} style={{ width: `${Math.max(2, item.score)}%` }} />
              </div>
              <p className="text-xs text-ink-muted">{item.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      {result.characteristics.length > 0 && (
        <section aria-label="Detected characteristics">
          <h4 className="mb-2 text-sm font-medium text-ink">Your sound</h4>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {result.characteristics.map((c) => (
              <div key={c.id}>
                <dt className="text-xs text-ink-muted">{c.label}</dt>
                <dd className="font-mono text-ink">{c.display}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <ResultVisualsView visuals={result.visuals} />
      <HowToReadScore strategyId={result.strategyId} />
      <p className="text-xs text-ink-subtle">
        Method: {result.strategyId} v{result.algorithmVersion}, computed on this device.
      </p>
    </div>
  );
}
