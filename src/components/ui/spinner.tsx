import { cx } from "./cx";

/** Decorative spinner; pair it with visible or sr-only text describing what is loading. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-control bg-surface-raised motion-reduce:animate-none", className)} />;
}
