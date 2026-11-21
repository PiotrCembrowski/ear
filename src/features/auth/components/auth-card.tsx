import type { ReactNode } from "react";

/** Shared frame for the sign-in / sign-up / password pages. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-panel border border-line bg-surface p-6 shadow-card sm:p-8">
        <div className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {description && <p className="text-sm leading-relaxed text-ink-muted">{description}</p>}
        </div>
        {children}
      </div>
      {footer && <p className="text-center text-sm text-ink-muted">{footer}</p>}
    </div>
  );
}
