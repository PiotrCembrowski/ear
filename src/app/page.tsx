import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { ROUTES } from "@/lib/auth/routes";

/**
 * Temporary home page. It links only to pages that exist (sign in / sign up).
 * Replaced by the full landing page in Phase 8.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-5">
        <Logo />
        <nav aria-label="Account" className="flex items-center gap-2">
          <ButtonLink href={ROUTES.signIn} variant="ghost" size="sm">
            Sign in
          </ButtonLink>
          <ButtonLink href={ROUTES.signUp} size="sm">
            Create account
          </ButtonLink>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 pb-24">
        <h1 className="bg-gradient-to-r from-brand-strong to-brand-2 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
          Hear how close you are.
        </h1>
        <p className="text-lg leading-relaxed text-ink-muted">
          Live sound analysis in your browser: identify notes, compare sounds against a reference library, and get honest,
          explained results. Your audio never leaves your device.
        </p>
        <p className="text-sm text-ink-subtle">
          SoundMatch is being built in stages. Accounts work today; the Listen screen is coming next.
        </p>
      </main>
    </div>
  );
}
