import { Alert } from "@/components/ui/alert";
import { ClosestResultView, type CandidateLabel } from "@/features/comparison/components/closest-result-view";
import { ComparisonResultView } from "@/features/comparison/components/comparison-result-view";
import { WarningList } from "@/features/comparison/components/warning-list";
import type { Json } from "@/lib/supabase/database.types";
import { storedResultSchema } from "@/lib/validation/comparisons";

/** Renders a saved result summary with the same views as the live Listen screen. */
export function StoredResultView({ result }: { result: Json }) {
  const parsed = storedResultSchema.safeParse(result);
  if (!parsed.success) {
    return <Alert tone="warning">This result was saved in an older format and can&apos;t be displayed in detail.</Alert>;
  }
  const stored = parsed.data;
  if (stored.mode === "compare") {
    const { schema: _schema, mode: _mode, reference, ...comparison } = stored;
    return <ComparisonResultView result={comparison} reference={{ name: reference.name, noteName: reference.noteName, isSynthetic: reference.isSynthetic }} />;
  }
  if (stored.mode === "closest") {
    const labels = new Map<string, CandidateLabel>(
      stored.matches.map((m) => [
        m.id,
        { name: m.name ?? "Deleted sample", noteName: m.noteName ?? "?", velocity: m.velocity ?? null, variant: m.variant ?? "", isSynthetic: m.isSynthetic ?? false },
      ]),
    );
    const { schema: _schema, mode: _mode, instrument, variant: _variant, ...closest } = stored;
    return (
      <ClosestResultView
        result={{ ...closest, matches: closest.matches.map((m) => ({ id: m.id, score: m.score, cents: m.cents, timbreScore: m.timbreScore })) }}
        labels={labels}
        instrumentName={instrument.name}
      />
    );
  }
  const cents = Math.round(stored.cents);
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-muted">Note</dt>
          <dd className="text-2xl font-semibold text-ink">{stored.name.replace("#", "♯")}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Offset</dt>
          <dd className="font-mono text-ink">{cents === 0 ? "In tune" : `${cents > 0 ? "+" : "−"}${Math.abs(cents)} cents`}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Frequency</dt>
          <dd className="font-mono text-ink">{stored.hz.toFixed(1)} Hz</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Confidence</dt>
          <dd className="font-mono text-ink capitalize">{stored.confidence.level}</dd>
        </div>
      </dl>
      <WarningList warnings={stored.warnings} />
    </div>
  );
}
