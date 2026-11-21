"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WarningList } from "@/features/comparison/components/warning-list";
import type { ListenController, ListenState } from "../listen-controller";
import { SaveStatus } from "./result-panel";

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

/** Summary of the last complete sound: appears when a sound ends. */
export function NoteResultCard({ state, controller, signedIn }: { state: ListenState; controller: ListenController; signedIn: boolean }) {
  const note = state.lastNote;
  const saved = state.save.status !== "idle" && "sequence" in state.save && note && state.save.sequence === note.sequence;
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
            <WarningList warnings={note.warnings} />
            {note.reading &&
              (signedIn ? (
                saved ? (
                  <SaveStatus save={state.save} sequence={note.sequence} onSave={() => void controller.saveLastNote()} />
                ) : (
                  <Button variant="secondary" size="sm" className="self-start" onClick={() => void controller.saveLastNote()}>
                    Save this note to history
                  </Button>
                )
              ) : (
                <p className="text-xs text-ink-subtle">Sign in to keep a history of your notes.</p>
              ))}
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
