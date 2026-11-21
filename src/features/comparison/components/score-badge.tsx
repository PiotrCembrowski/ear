import { cx } from "@/components/ui/cx";

/** Band labels give the number a meaning without relying on colour. */
export function scoreBand(score: number): { label: string; tone: string } {
  if (score >= 90) return { label: "Very close", tone: "text-success" };
  if (score >= 70) return { label: "Close", tone: "text-success" };
  if (score >= 40) return { label: "Somewhat similar", tone: "text-warning" };
  return { label: "Different", tone: "text-danger" };
}

export function ScoreDisplay({ score, size = "lg" }: { score: number; size?: "lg" | "sm" }) {
  const band = scoreBand(score);
  return (
    <div className="flex items-baseline gap-3">
      <span className={cx("font-semibold tracking-tight text-ink tabular-nums", size === "lg" ? "text-6xl" : "text-2xl")}>{Math.round(score)}</span>
      <span className="flex flex-col">
        <span className="text-xs text-ink-subtle">/ 100</span>
        <span className={cx("text-sm font-medium", band.tone)}>{band.label}</span>
      </span>
    </div>
  );
}
