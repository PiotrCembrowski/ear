import { useId, type ComponentProps, type ReactNode } from "react";
import { cx } from "./cx";
import { inputClasses } from "./text-field";

type FieldFrameProps = {
  label: string;
  hint?: string;
  errors?: string[];
  className?: string;
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
};

/** Label + control + hint + errors, linked with aria attributes (same pattern as TextField). */
function FieldFrame({ label, hint, errors, className, children }: FieldFrameProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
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
      {children({ id, describedBy: [hintId, errorId].filter(Boolean).join(" ") || undefined, invalid: Boolean(errorId) })}
      {errorId && (
        <p id={errorId} className="text-sm text-danger">
          {errors!.join(" ")}
        </p>
      )}
    </div>
  );
}

type SelectFieldProps = Omit<ComponentProps<"select">, "id"> & {
  label: string;
  name: string;
  hint?: string;
  errors?: string[];
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
};

export function SelectField({ label, hint, errors, options, placeholder, className, ...props }: SelectFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} errors={errors} className={className}>
      {({ id, describedBy, invalid }) => (
        <select
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx(inputClasses, "pr-8", invalid ? "border-danger" : "border-line-control")}
          {...props}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldFrame>
  );
}

type TextAreaFieldProps = Omit<ComponentProps<"textarea">, "id"> & { label: string; name: string; hint?: string; errors?: string[] };

export function TextAreaField({ label, hint, errors, className, ...props }: TextAreaFieldProps) {
  return (
    <FieldFrame label={label} hint={hint} errors={errors} className={className}>
      {({ id, describedBy, invalid }) => (
        <textarea
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cx(inputClasses, "h-auto min-h-24 py-2.5", invalid ? "border-danger" : "border-line-control")}
          {...props}
        />
      )}
    </FieldFrame>
  );
}

type CheckboxFieldProps = Omit<ComponentProps<"input">, "id" | "type"> & { label: string; name: string; hint?: string };

export function CheckboxField({ label, hint, className, ...props }: CheckboxFieldProps) {
  const id = useId();
  return (
    <div className={cx("flex gap-3", className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-line-control accent-[var(--color-brand)]"
        {...props}
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-ink">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-ink-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
