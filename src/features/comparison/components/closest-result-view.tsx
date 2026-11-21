import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { ClosestResult } from "@/lib/audio-engine/closest";
import { HowToReadScore } from "./how-to-read";
import { ScoreDisplay } from "./score-badge";
import { WarningList } from "./warning-list";

export type CandidateLabel = { name: string; noteName: string; velocity: number | null; variant: string; isSynthetic: boolean };

/** Top matches among an instrument's samples. */
export function ClosestResultView({
  result,
  labels,
  instrumentName,
  actions,
}: {
  result: ClosestResult;
  labels: ReadonlyMap<string, CandidateLabel>;
  instrumentName: string;
  actions?: ReactNode;
}) {
  const best = result.matches[0];
  const bestLabel = best ? labels.get(best.id) : undefined;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs tracking-wide text-ink-subtle uppercase">Closest {instrumentName.toLowerCase()} sample</p>
          {best && bestLabel ? (
            <>
              <p className="text-3xl font-semibold text-ink">{bestLabel.noteName.replace("#", "♯")}</p>
              <ScoreDisplay score={best.score} size="sm" />
            </>
          ) : (
            <p className="text-lg text-ink">No match: no clear pitch was detected.</p>
          )}
        </div>
        {actions}
      </div>
      <WarningList warnings={result.warnings} />
      {result.matches.length > 0 && (
        <ol className="flex flex-col divide-y divide-line rounded-control border border-line" aria-label="Top matches">
          {result.matches.map((match, index) => {
            const label = labels.get(match.id);
            return (
              <li key={match.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <span className="w-5 font-mono text-ink-subtle">{index + 1}.</span>
                <span className="min-w-24 font-medium text-ink">{label?.noteName.replace("#", "♯") ?? "?"}</span>
                <span className="text-xs text-ink-muted">
                  {label?.variant}
                  {label?.velocity !== null && label?.velocity !== undefined && ` · velocity ${label.velocity}`}
                </span>
                {label?.isSynthetic && <Badge tone="warning">Synthetic</Badge>}
                <span className="ml-auto flex items-center gap-4 font-mono text-xs text-ink-muted tabular-nums">
                  {match.cents !== null && <span>{`${match.cents > 0 ? "+" : match.cents < 0 ? "−" : "±"}${Math.abs(Math.round(match.cents))}¢`}</span>}
                  {match.timbreScore !== null && <span title="Timbre score used to break a tie">tone {Math.round(match.timbreScore)}</span>}
                  <span className="text-sm text-ink">{Math.round(match.score)}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="text-sm text-ink-muted">
        Compared with {result.compared} sample{result.compared === 1 ? "" : "s"}.{" "}
        {result.strategyId === "pitch" ? "Ranked by pitch; samples of the same note are ordered by tone colour." : "Ranked by tone colour."}
      </p>
      <HowToReadScore strategyId={result.strategyId} />
    </div>
  );
}
