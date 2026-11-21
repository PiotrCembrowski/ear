"use client";

import { cx } from "@/components/ui/cx";
import type { SessionSnapshot } from "@/lib/audio-engine/listening-session";

const MIN_DB = -80;
const MAX_DB = 0;
const toPercent = (db: number) => Math.max(0, Math.min(100, ((db - MIN_DB) / (MAX_DB - MIN_DB)) * 100));

/**
 * Input level with the background-noise level and the "sound detected"
 * threshold marked, so the sensitivity setting is easy to understand.
 */
export function LevelMeter({ snapshot }: { snapshot: SessionSnapshot | null }) {
  const level = snapshot?.levelDb ?? MIN_DB;
  const active = snapshot?.soundActive ?? false;
  const valueText = snapshot
    ? `Input level ${Math.round(level)} decibels${active ? ", sound detected" : ""}. Sounds count above ${Math.round(snapshot.thresholdDb)} decibels.`
    : "Not listening";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-xs text-ink-muted">
        <span id="level-label">Input level</span>
        <span className="font-mono tabular-nums">{snapshot ? `${Math.round(level)} dB` : "—"}</span>
      </div>
      <div
        role="meter"
        aria-labelledby="level-label"
        aria-valuemin={MIN_DB}
        aria-valuemax={MAX_DB}
        aria-valuenow={Math.round(level)}
        aria-valuetext={valueText}
        className="relative h-3 overflow-hidden rounded-full border border-line bg-surface-raised"
      >
        {snapshot && (
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 bg-ink-subtle/25"
            style={{ width: `${toPercent(snapshot.noiseFloorDb)}%` }}
            title="Background noise"
          />
        )}
        <div
          aria-hidden
          className={cx(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-75 ease-linear motion-reduce:transition-none",
            active ? "bg-gradient-to-r from-brand to-brand-2" : "bg-ink-muted/60",
          )}
          style={{ width: `${toPercent(level)}%` }}
        />
        {snapshot && (
          <div
            aria-hidden
            className="absolute inset-y-[-2px] w-0.5 bg-warning"
            style={{ left: `${toPercent(snapshot.thresholdDb)}%` }}
          />
        )}
      </div>
      <div className="flex items-center gap-4 text-xs text-ink-subtle" aria-hidden>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-ink-subtle/40" /> Background
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-0.5 bg-warning" /> Detection threshold
        </span>
      </div>
    </div>
  );
}
