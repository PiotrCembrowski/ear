"use client";

import { useRef, type KeyboardEvent } from "react";
import { cx } from "@/components/ui/cx";
import type { ListenMode } from "../listen-controller";

const MODES: Array<{ id: ListenMode; label: string }> = [
  { id: "identify", label: "Identify note" },
  { id: "compare", label: "Compare" },
  { id: "closest", label: "Closest match" },
];

/** Accessible tab list (arrow keys move between tabs, as in the WAI-ARIA tabs pattern). */
export function ModeTabs({ mode, onChange }: { mode: ListenMode; onChange(mode: ListenMode): void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKeyDown(event: KeyboardEvent, index: number) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? MODES.length - 1 : (index + delta + MODES.length) % MODES.length;
    if (delta === 0 && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    onChange(MODES[target]!.id);
    refs.current[target]?.focus();
  }
  return (
    <div role="tablist" aria-label="Listening mode" className="inline-flex flex-wrap gap-1 rounded-card border border-line bg-surface p-1">
      {MODES.map((m, index) => {
        const selected = m.id === mode;
        return (
          <button
            key={m.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`mode-tab-${m.id}`}
            aria-selected={selected}
            aria-controls="listen-mode-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(m.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cx(
              "rounded-control px-4 py-2 text-sm font-medium transition-colors",
              selected ? "bg-surface-overlay text-ink shadow-card" : "text-ink-muted hover:text-ink",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
