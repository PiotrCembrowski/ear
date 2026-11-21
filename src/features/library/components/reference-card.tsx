import { ExternalLink, FlaskConical, Lock } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { ReferenceListItem } from "@/lib/services/references";

export function formatDuration(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`;
}

/** Synthetic tones are always labelled, so they can never pass for real recordings. */
export function ReferenceBadges({ reference }: { reference: ReferenceListItem }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge>{reference.category.name}</Badge>
      {reference.sample && (
        <Badge tone="brand">
          {reference.sample.noteName.replace("#", "♯")}
          {reference.sample.velocity !== null && ` · v${reference.sample.velocity}`}
        </Badge>
      )}
      {reference.isSynthetic && (
        <Badge tone="warning">
          <FlaskConical aria-hidden className="size-3" /> Synthetic test tone
        </Badge>
      )}
      {reference.visibility === "private" && (
        <Badge tone="info">
          <Lock aria-hidden className="size-3" /> Private
        </Badge>
      )}
    </div>
  );
}

export function Provenance({ reference }: { reference: ReferenceListItem }) {
  return (
    <p className="text-xs leading-relaxed text-ink-subtle">
      License: <span className="text-ink-muted">{reference.license}</span>
      {reference.attribution && (
        <>
          {" · "}
          {reference.attribution}
        </>
      )}
      {reference.sourceUrl && (
        <>
          {" · "}
          <a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-brand-strong hover:underline">
            Source <ExternalLink aria-hidden className="size-3" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </>
      )}
    </p>
  );
}

/** Library card: what the sound is, where it comes from, and a preview player. */
export function ReferenceCard({ reference, audioUrl, actions }: { reference: ReferenceListItem; audioUrl: string | null; actions?: ReactNode }) {
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card" aria-labelledby={`ref-${reference.id}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 id={`ref-${reference.id}`} className="text-sm font-semibold text-ink">
          {reference.name}
        </h3>
        <span className="shrink-0 font-mono text-xs text-ink-muted">{formatDuration(reference.durationMs)}</span>
      </div>
      <ReferenceBadges reference={reference} />
      {reference.description && <p className="line-clamp-3 text-sm text-ink-muted">{reference.description}</p>}
      {reference.tags.length > 0 && (
        <p className="text-xs text-ink-subtle">
          <span className="sr-only">Tags: </span>
          {reference.tags.map((tag) => `#${tag}`).join("  ")}
        </p>
      )}
      {audioUrl ? (
        // Preview of the stored reference file (never user audio). Loads only when played.
        <audio controls preload="none" src={audioUrl} className="h-9 w-full" aria-label={`Preview ${reference.name}`} />
      ) : (
        <p className="text-xs text-ink-subtle">Preview unavailable.</p>
      )}
      <Provenance reference={reference} />
      {actions}
    </article>
  );
}
