/** Short, honest explanation of what a score means, per strategy. */
export function HowToReadScore({ strategyId }: { strategyId: string }) {
  return (
    <details className="rounded-control border border-line bg-surface-raised/50 px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium text-ink select-none">How to read this score</summary>
      <div className="mt-2 flex flex-col gap-2 leading-relaxed text-ink-muted">
        <p>
          This is a <strong className="text-ink">heuristic similarity score</strong>, not a validated measurement. It is computed in your
          browser from features of your sound and of the reference; small changes in microphone, room or playing can move it.
        </p>
        {strategyId === "pitch" ? (
          <p>
            For notes, only <strong className="text-ink">pitch</strong> is scored: 100 means the same pitch as the reference, about 90 is 10
            cents off (most listeners hear that as in tune), 50 is a quarter-tone off, and 0 is 50 cents or more (or a different note).
            Stability and confidence are shown for context.
          </p>
        ) : (
          <p>
            For general sounds, the score combines <strong className="text-ink">tone colour</strong> (the shape of the spectrum, after lining
            the two sounds up in time), <strong className="text-ink">loudness shape</strong>, <strong className="text-ink">brightness</strong>,
            high-frequency content and length. Overall volume is ignored. Above ~80 usually means the same kind of sound; below ~30 means
            clearly different.
          </p>
        )}
        <p>Use it to compare your own attempts with each other, rather than as an absolute grade.</p>
      </div>
    </details>
  );
}
