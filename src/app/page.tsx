import { APP_NAME } from "@/lib/config/app-config";

/**
 * Temporary home page for the foundation phase. It deliberately has no links
 * or buttons: the pages they would point to are built in later phases.
 * Replaced by the real landing page in Phase 8.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-subtle">Under construction</p>
      <h1 className="bg-gradient-to-r from-brand-strong to-brand-2 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
        {APP_NAME}
      </h1>
      <p className="text-lg leading-relaxed text-ink-muted">
        Live sound analysis in your browser: identify notes, compare sounds against a reference library, and get honest,
        explained results. Your audio never leaves your device.
      </p>
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <p className="text-sm leading-relaxed text-ink-muted">
          The foundation is in place: configuration, design tokens, database schema with Row Level Security, and storage
          policies. Sign-in, the Listen screen and the reference library arrive in the next phases.
        </p>
      </div>
    </main>
  );
}
