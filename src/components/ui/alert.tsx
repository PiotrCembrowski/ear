import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONE: Record<AlertTone, { classes: string; Icon: typeof Info }> = {
  info: { classes: "border-info/40 bg-info/10 text-info", Icon: Info },
  success: { classes: "border-success/40 bg-success/10 text-success", Icon: CircleCheck },
  warning: { classes: "border-warning/40 bg-warning/10 text-warning", Icon: TriangleAlert },
  danger: { classes: "border-danger/40 bg-danger/10 text-danger", Icon: CircleAlert },
};

/**
 * Inline message. Errors use role="alert" (announced immediately); other
 * tones use role="status" (announced politely).
 */
export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const { classes, Icon } = TONE[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cx("flex gap-3 rounded-control border px-4 py-3 text-sm", classes, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="leading-relaxed text-ink">{children}</div>}
      </div>
    </div>
  );
}
