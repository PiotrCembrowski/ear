import Link from "next/link";
import { cx } from "./cx";

/** Previous / next links that keep the current query string. Works without JavaScript. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (target: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const linkClasses = "rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:bg-surface-raised";
  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-between gap-4">
      {page > 1 ? (
        <Link href={href(page - 1)} className={linkClasses} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-ink-muted">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={cx(linkClasses)} rel="next">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
