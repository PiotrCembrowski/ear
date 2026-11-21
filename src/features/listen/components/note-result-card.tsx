"use client";

import { TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LastNote } from "../listen-controller";

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

/** Summary of the last complete sound: appears when a sound ends. */
export function NoteResultCard({ note }: { note: LastNote | null }) {
  return (
    <Card aria-labelledby="last-note-heading">
      <CardHeader>
        <CardTitle id="last-note-heading">Last note</CardTitle>
      </CardHeader>
      <CardContent>
        {!note ? (
          <p className="text-sm text-ink-muted">Play a single note. When it ends, its summary appears here.</p>
        ) : (
          <div key={note.sequence} className="flex flex-col gap-4">
            {note.reading ? (
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Item label="Note" value={note.reading.name.replace("#", "♯")} large />
                <Item
                  label="Offset"
                  value={Math.round(note.reading.cents) === 0 ? "In tune" : `${note.reading.cents > 0 ? "+" : "−"}${Math.abs(Math.round(note.reading.cents))} cents`}
                />
                <Item label="Frequency" value={`${note.reading.hz.toFixed(1)} Hz`} />
                <Item label="Confidence" value={CONFIDENCE_LABEL[note.reading.confidence.level]} />
              </dl>
            ) : (
              <p className="text-sm text-ink">No clear pitch was detected in that sound.</p>
            )}
            <p className="text-xs text-ink-subtle">Sound length {(note.durationMs / 1000).toFixed(2)} s</p>
            {note.warnings.length > 0 && (
              <ul className="flex flex-col gap-1.5" aria-label="Notes about this result">
                {note.warnings.map((warning) => (
                  <li key={warning.code} className="flex gap-2 text-sm text-warning">
                    <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span className="text-ink">{warning.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Item({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={large ? "text-2xl font-semibold text-ink" : "font-mono text-ink tabular-nums"}>{value}</dd>
    </div>
  );
}
