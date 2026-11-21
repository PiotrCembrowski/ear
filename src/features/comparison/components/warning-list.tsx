import { TriangleAlert } from "lucide-react";
import type { QualityWarning } from "@/lib/audio-engine/types";

/** Plain-language notes about result quality. Icon + text, never colour alone. */
export function WarningList({ warnings }: { warnings: QualityWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Notes about this result">
      {warnings.map((warning) => (
        <li key={warning.code} className="flex gap-2 text-sm">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          <span className="text-ink">{warning.message}</span>
        </li>
      ))}
    </ul>
  );
}
