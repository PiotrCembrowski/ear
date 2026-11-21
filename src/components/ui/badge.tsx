import type { ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line-strong bg-surface-raised text-ink-muted",
  brand: "border-brand/40 bg-brand/10 text-brand-strong",
  success: "border-success/40 bg-success/10 text-success",
  warning: "border-warning/40 bg-warning/10 text-warning",
  danger: "border-danger/40 bg-danger/10 text-danger",
  info: "border-info/40 bg-info/10 text-info",
};

/** Small status label. Never rely on its color alone: the text says it too. */
export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}
