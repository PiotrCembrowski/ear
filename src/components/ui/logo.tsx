import { useId } from "react";
import { APP_NAME } from "@/lib/config/app-config";
import { cx } from "./cx";

/** SoundMatch mark: two overlapping waveforms (yours and the reference) in the brand gradient. */
export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: the sidebar and mobile header both render a logo, and a
  // duplicate id would make one of them reference a gradient inside a hidden element.
  const gradientId = `sm-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cx("size-8", className)}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-brand)" />
          <stop offset="1" stopColor="var(--color-brand-2)" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--color-surface-raised)" stroke="var(--color-line-strong)" />
      <path
        d="M6 16h3l2-6 3 12 3-9 2 6 2-3h5"
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** `compact`: on very small screens show only the mark (the name stays available to screen readers). */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={cx("text-lg font-semibold tracking-tight text-ink", compact && "max-[400px]:sr-only")}>{APP_NAME}</span>
    </span>
  );
}
