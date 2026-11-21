import Link from "next/link";
import type { ComponentProps } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonStyleProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-brand text-ink-inverse shadow-glow hover:bg-brand-strong disabled:bg-surface-overlay disabled:text-ink-subtle disabled:shadow-none",
  secondary:
    "border border-line-strong bg-surface-raised text-ink hover:border-line-control hover:bg-surface-overlay disabled:text-ink-subtle",
  ghost: "text-ink-muted hover:bg-surface-raised hover:text-ink disabled:text-ink-subtle",
  danger: "bg-danger text-ink-inverse hover:brightness-110 disabled:bg-surface-overlay disabled:text-ink-subtle",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 px-3 text-sm",
  md: "h-10 gap-2 px-4 text-sm",
  lg: "h-12 gap-2 px-6 text-base",
};

/** Shared by <Button> and <ButtonLink> so both look identical. */
export function buttonClasses({ variant = "primary", size = "md", fullWidth = false }: ButtonStyleProps = {}): string {
  return cx(
    "inline-flex select-none items-center justify-center rounded-control font-medium whitespace-nowrap",
    "transition-colors duration-[var(--duration-fast)] ease-out-soft",
    "disabled:cursor-not-allowed",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidth && "w-full",
  );
}

export type ButtonProps = ComponentProps<"button"> & ButtonStyleProps;

export function Button({ variant, size, fullWidth, className, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cx(buttonClasses({ variant, size, fullWidth }), className)} {...props} />;
}

export type ButtonLinkProps = ComponentProps<typeof Link> & ButtonStyleProps;

/** A link that looks like a button. Use for navigation; use <Button> for actions. */
export function ButtonLink({ variant, size, fullWidth, className, ...props }: ButtonLinkProps) {
  return <Link className={cx(buttonClasses({ variant, size, fullWidth }), className)} {...props} />;
}
