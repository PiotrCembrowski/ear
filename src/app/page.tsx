import { PublicHeader } from "@/components/app-shell/public-header";
import { ButtonLink } from "@/components/ui/button";
import { ROUTES } from "@/lib/auth/routes";

/**
 * Temporary home page. It links only to pages that exist (listen, sign in, sign up).
 * Replaced by the full landing page in Phase 8.
 */
export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-6 pb-24">
        <h1 className="bg-gradient-to-r from-brand-strong to-brand-2 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
          Hear how close you are.
        </h1>
        <p className="text-lg leading-relaxed text-ink-muted">
          Live sound analysis in your browser: identify notes, compare sounds against a reference library, and get honest,
          explained results. Your audio never leaves your device.
        </p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href={ROUTES.listen} size="lg">
            Try the live tuner
          </ButtonLink>
        </div>
        <p className="text-sm text-ink-subtle">
          SoundMatch is being built in stages. Note identification works today, with no account needed; comparing against reference sounds is
          coming next.
        </p>
      </main>
    </div>
  );
}
