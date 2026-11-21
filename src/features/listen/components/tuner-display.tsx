"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import type { TunerReading } from "@/lib/audio-engine/listening-session";

/** In tune within ±5 cents (barely audible), close within ±15. */
function tuneState(cents: number): { label: string; tone: string } {
  const a = Math.abs(cents);
  if (a <= 5) return { label: "In tune", tone: "text-success" };
  if (a <= 15) return { label: cents > 0 ? "Slightly sharp" : "Slightly flat", tone: "text-warning" };
  return { label: cents > 0 ? "Sharp" : "Flat", tone: "text-danger" };
}

function signedCents(cents: number): string {
  const r = Math.round(cents);
  return r === 0 ? "±0" : `${r > 0 ? "+" : "−"}${Math.abs(r)}`;
}

function spokenCents(cents: number): string {
  const r = Math.round(cents);
  return r === 0 ? "in tune" : `${r > 0 ? "plus" : "minus"} ${Math.abs(r)} cents`;
}

/** Splits "C#4" into letter+accidental and octave for display. */
function splitName(name: string): { pitchClass: string; octave: string } {
  const match = /^([A-G]#?)(-?\d+)$/.exec(name);
  return match ? { pitchClass: match[1]!.replace("#", "♯"), octave: match[2]! } : { pitchClass: name, octave: "" };
}

/**
 * The live tuner: note name, a cents needle from −50 to +50, and the exact
 * frequency. A polite live region announces the note for screen readers, at
 * most every 1.5 s and only when it changes meaningfully.
 */
export function TunerDisplay({ tuner, listening, a4Hz }: { tuner: TunerReading | null; listening: boolean; a4Hz: number }) {
  const [announcement, setAnnouncement] = useState("");
  const lastAnnounced = useRef({ text: "", at: 0 });

  const cents = tuner?.note.cents ?? 0;
  const state = tuner ? tuneState(cents) : null;
  const name = tuner ? splitName(tuner.note.name) : null;

  useEffect(() => {
    if (!tuner) return;
    const text = `Detected ${tuner.note.name}, ${spokenCents(Math.round(tuner.note.cents / 5) * 5)}`;
    const now = Date.now();
    if (text !== lastAnnounced.current.text && now - lastAnnounced.current.at > 1500) {
      lastAnnounced.current = { text, at: now };
      setAnnouncement(text);
    }
  }, [tuner]);

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex min-h-[7.5rem] items-end justify-center gap-1" aria-hidden>
        {name ? (
          <>
            <span className="text-[6.5rem] leading-none font-semibold tracking-tight text-ink tabular-nums">{name.pitchClass}</span>
            <span className="mb-3 text-3xl font-medium text-ink-muted">{name.octave}</span>
          </>
        ) : (
          <span className="mb-2 text-4xl font-medium text-ink-subtle">{listening ? "Play a note" : "—"}</span>
        )}
      </div>

      <CentsGauge cents={tuner ? cents : null} />

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-sm" aria-hidden>
        <span className={cx("font-medium", state?.tone ?? "text-ink-subtle")}>{state ? state.label : "No pitch"}</span>
        <span className="font-mono text-ink-muted tabular-nums">{tuner ? `${signedCents(cents)} cents` : "— cents"}</span>
        <span className="font-mono text-ink-muted tabular-nums">{tuner ? `${tuner.hz.toFixed(1)} Hz` : "— Hz"}</span>
      </div>
      <p className="text-xs text-ink-subtle">Reference pitch A4 = {a4Hz} Hz</p>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </div>
  );
}

/** Horizontal gauge: −50 … +50 cents, green zone ±5, needle at the current offset. */
function CentsGauge({ cents }: { cents: number | null }) {
  const position = cents === null ? 50 : 50 + Math.max(-50, Math.min(50, cents));
  const inTune = cents !== null && Math.abs(cents) <= 5;
  return (
    <div className="w-full max-w-md" aria-hidden>
      <div className="relative h-10">
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line-strong" />
        <div className="absolute top-1/2 h-5 -translate-y-1/2 rounded-sm bg-success/15" style={{ left: "45%", width: "10%" }} />
        {[-50, -25, 0, 25, 50].map((tick) => (
          <div
            key={tick}
            className={cx("absolute top-1/2 w-px -translate-y-1/2", tick === 0 ? "h-7 bg-ink-muted" : "h-3 bg-line-control")}
            style={{ left: `${50 + tick}%` }}
          />
        ))}
        <div
          className={cx(
            "absolute top-0 h-full w-1 -translate-x-1/2 rounded-full transition-[left] duration-100 ease-out motion-reduce:transition-none",
            cents === null ? "bg-ink-subtle/40" : inTune ? "bg-success shadow-[0_0_12px_var(--color-success)]" : "bg-brand-strong",
          )}
          style={{ left: `${position}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[0.7rem] text-ink-subtle">
        <span>−50</span>
        <span>−25</span>
        <span>0</span>
        <span>+25</span>
        <span>+50</span>
      </div>
    </div>
  );
}
