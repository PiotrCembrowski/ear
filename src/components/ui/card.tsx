import type { ComponentProps } from "react";
import { cx } from "./cx";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-card border border-line bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("flex flex-col gap-1 p-5 pb-0 sm:p-6 sm:pb-0", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cx("text-base font-semibold tracking-tight text-ink", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cx("text-sm leading-relaxed text-ink-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("p-5 sm:p-6", className)} {...props} />;
}
