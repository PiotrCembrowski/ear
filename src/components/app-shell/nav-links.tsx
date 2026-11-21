"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";
import { isNavItemActive, navItemsFor } from "@/features/navigation/nav-items";

/** Sidebar links; highlights the current section and marks it aria-current. */
export function NavLinks({ onNavigate, isAdmin = false }: { onNavigate?: () => void; isAdmin?: boolean }) {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1">
      {navItemsFor(isAdmin).map(({ href, label, icon: Icon }) => {
        const active = isNavItemActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex h-10 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors",
                active ? "bg-surface-overlay text-ink" : "text-ink-muted hover:bg-surface-raised hover:text-ink",
              )}
            >
              <Icon aria-hidden className={cx("size-4", active ? "text-brand-strong" : "text-ink-subtle")} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
