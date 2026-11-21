import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { ROUTES } from "@/lib/auth/routes";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";

type ShellUser = { displayName: string | null; email: string | null };

function UserSummary({ user }: { user: ShellUser }) {
  const name = user.displayName ?? user.email ?? "Signed in";
  return (
    <div className="flex min-w-0 flex-col px-3 py-2">
      <span className="truncate text-sm font-medium text-ink">{name}</span>
      {user.displayName && user.email && <span className="truncate text-xs text-ink-subtle">{user.email}</span>}
    </div>
  );
}

/** Layout for signed-in pages: sidebar on large screens, top bar + menu on small ones. */
export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const accountFooter = (
    <div className="flex flex-col gap-1">
      <UserSummary user={user} />
      <SignOutButton fullWidth />
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface-overlay focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      {/* Large screens: fixed sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/60 px-3 py-5 lg:flex">
        <Link href={ROUTES.dashboard} className="mb-8 rounded-control px-3" aria-label="SoundMatch dashboard">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex-1">
          <NavLinks />
        </nav>
        <div className="border-t border-line pt-3">{accountFooter}</div>
      </aside>

      {/* Small screens: top bar */}
      <header className="relative flex h-14 items-center justify-between border-b border-line bg-surface/80 px-4 backdrop-blur lg:hidden">
        <Link href={ROUTES.dashboard} className="rounded-control" aria-label="SoundMatch dashboard">
          <Logo />
        </Link>
        <MobileNav footer={accountFooter} />
      </header>

      <main id="main-content" tabIndex={-1} className="min-w-0 px-4 py-8 focus:outline-none sm:px-8 lg:px-12 lg:py-10">
        <div className="mx-auto w-full max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

/** Consistent page heading for app pages. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {description && <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
