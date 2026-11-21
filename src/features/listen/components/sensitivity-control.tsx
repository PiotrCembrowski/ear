"use client";

import { useId } from "react";
import { SENSITIVITY_DB } from "@/lib/config/app-config";

/**
 * Noise-gate sensitivity. Internally it's "dB above background noise needed
 * to count as a sound"; the slider is flipped so right = more sensitive,
 * which matches how people think about it.
 */
export function SensitivityControl({ value, onChange }: { value: number; onChange(value: number): void }) {
  const id = useId();
  const sliderValue = SENSITIVITY_DB.max + SENSITIVITY_DB.min - value;
  const description =
    value <= 9 ? "Picks up quiet sounds; may react to background noise." : value >= 20 ? "Only loud, close sounds count." : "Balanced for most rooms.";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          Sensitivity
        </label>
        <span className="font-mono text-xs text-ink-muted">{value} dB above background</span>
      </div>
      <input
        id={id}
        type="range"
        min={SENSITIVITY_DB.min}
        max={SENSITIVITY_DB.max}
        step={1}
        value={sliderValue}
        onChange={(e) => onChange(SENSITIVITY_DB.max + SENSITIVITY_DB.min - Number(e.target.value))}
        aria-valuetext={`${value} decibels above background noise. ${description}`}
        aria-describedby={`${id}-hint`}
        className="h-2 w-full cursor-pointer accent-[var(--color-brand)]"
      />
      <div className="flex justify-between text-xs text-ink-subtle" aria-hidden>
        <span>Less sensitive</span>
        <span>More sensitive</span>
      </div>
      <p id={`${id}-hint`} className="text-xs text-ink-muted">
        {description}
      </p>
    </div>
  );
}
