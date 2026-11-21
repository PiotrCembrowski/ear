import { useId, type ComponentProps } from "react";
import { cx } from "./cx";

export const inputClasses = cx(
  "h-11 w-full rounded-control border bg-surface-raised px-3.5 text-[0.95rem] text-ink placeholder:text-ink-subtle",
  "transition-colors duration-[var(--duration-fast)]",
  "focus-visible:border-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
  "disabled:cursor-not-allowed disabled:opacity-60",
);

type TextFieldProps = Omit<ComponentProps<"input">, "id"> & {
  label: string;
  name: string;
  /** Shown under the label, always visible (e.g. password rules). */
  hint?: string;
  /** Validation error(s) for this field; announced to screen readers. */
  errors?: string[];
};

/**
 * Label + input + hint + error, wired together for accessibility:
 * the input is labelled, and the hint/error are linked via aria-describedby.
 */
export function TextField({ label, name, hint, errors, className, ...inputProps }: TextFieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  const invalid = Boolean(errorId);

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
      <input
        id={id}
        name={name}
        aria-invalid={invalid || undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(" ") || undefined}
        className={cx(inputClasses, invalid ? "border-danger" : "border-line-control")}
        {...inputProps}
      />
      {errorId && (
        <p id={errorId} className="text-sm text-danger">
          {errors!.join(" ")}
        </p>
      )}
    </div>
  );
}
