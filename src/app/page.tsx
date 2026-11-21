import { AudioLines, BookOpen, GitCompareArrows, History, ListOrdered, ShieldCheck, type LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/app-shell/public-header";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = {
  title: { absolute: "SoundMatch: live sound analysis in your browser" },
  description:
    "Play or sing into your microphone and see the note, how many cents off it is, and how closely it matches a reference sound. Your audio never leaves your device.",
};

const FEATURES: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: AudioLines,
    title: "Identify notes live",
    text: "A responsive tuner: the note name, how many cents sharp or flat, the exact frequency, and how confident the reading is. No account needed.",
  },
  {
    icon: GitCompareArrows,
    title: "Compare with a reference",
    text: "Pick a reference sound and play your version. Notes are compared by pitch; other sounds by tone colour, loudness shape and length.",
  },
  {
    icon: ListOrdered,
    title: "Closest match",
    text: "Play one note and see the five closest samples of an instrument, from all 88 piano keys and their velocity layers.",
  },
  {
    icon: BookOpen,
    title: "Reference library",
    text: "Browse and preview instrument notes and everyday sounds, each with its license and source.",
  },
  {
    icon: History,
    title: "Your history",
    text: "Results are saved as summaries you can search and revisit, so you can see your progress over time.",
  },
  {
    icon: ShieldCheck,
    title: "Private by design",
    text: "The microphone is on only while you're listening. Sound is analysed in your browser and discarded. Nothing is recorded or uploaded.",
  },
];

const STEPS = [
  { title: "Press Listen", text: "Allow the microphone. SoundMatch spends a quarter of a second measuring the room's background noise." },
  { title: "Play or sing", text: "It detects when a sound starts and ends by itself, and analyses it on your device as you play." },
  { title: "Read an honest result", text: "A score, what was measured, a breakdown, and plain warnings when something made the result less reliable." },
];

const USE_CASES = [
  { title: "Musicians", text: "Check intonation on long notes, warm up with the live tuner, or tune an instrument to A4 = 440 or 442 Hz." },
  { title: "Teachers and students", text: "Practise matching a reference note and keep a history of attempts to discuss in the next lesson." },
  { title: "Sound designers", text: "Compare a new take with a reference sound to judge how close the tone and shape are." },
  { title: "The curious", text: "Find out which piano key a whistle, a glass or a doorbell is closest to." },
];

/** Decorative preview of the Listen screen (aria-hidden; the text around it says the same). */
function HeroVisual() {
  return (
    <div aria-hidden className="relative rounded-panel border border-line bg-surface/80 p-6 shadow-card backdrop-blur sm:p-8">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full border border-live/50 bg-live/10 px-3 py-1 text-xs font-medium text-live">
          <span className="size-2 rounded-full bg-live" /> Listening
        </span>
        <span className="font-mono text-xs text-ink-subtle">A4 = 440 Hz</span>
      </div>
      <div className="mt-6 flex items-end justify-center gap-1">
        <span className="text-8xl leading-none font-semibold tracking-tight text-ink">A</span>
        <span className="mb-2 text-3xl text-ink-muted">4</span>
      </div>
      <svg viewBox="0 0 300 40" className="mx-auto mt-6 w-full max-w-xs">
        <line x1="0" y1="20" x2="300" y2="20" stroke="var(--color-line-strong)" />
        <rect x="135" y="10" width="30" height="20" rx="3" fill="var(--color-success)" opacity="0.15" />
        {[0, 75, 150, 225, 300].map((x) => (
          <line key={x} x1={x} y1={x === 150 ? 6 : 14} x2={x} y2={x === 150 ? 34 : 26} stroke="var(--color-line-control)" />
        ))}
        <rect x="157" y="2" width="4" height="36" rx="2" fill="var(--color-success)" />
      </svg>
      <p className="mt-2 text-center text-sm">
        <span className="font-medium text-success">In tune</span> <span className="font-mono text-ink-muted">+3 cents · 440.8 Hz</span>
      </p>
      <svg viewBox="0 0 300 60" className="mt-6 w-full">
        <defs>
          <linearGradient id="hero-wave" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-brand)" />
            <stop offset="1" stopColor="var(--color-brand-2)" />
          </linearGradient>
        </defs>
        <path
          d={Array.from({ length: 151 }, (_, i) => {
            const x = i * 2;
            const envelope = Math.sin((Math.PI * i) / 150);
            const y = 30 - envelope * 22 * Math.sin(i * 0.55) * (0.75 + 0.25 * Math.sin(i * 0.11));
            return `${i === 0 ? "M" : "L"}${x},${y.toFixed(1)}`;
          }).join(" ")}
          fill="none"
          stroke="url(#hero-wave)"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <PublicHeader />
      <main id="main-content" className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(ellipse_at_top,rgb(139_123_255/0.18),transparent_60%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
            <div className="flex flex-col gap-6">
              <p className="font-mono text-xs tracking-[0.2em] text-ink-subtle uppercase">Live sound analysis in your browser</p>
              <h1 className="text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
                Hear how{" "}
                <span className="bg-gradient-to-r from-brand-strong to-brand-2 bg-clip-text text-transparent">close you are.</span>
              </h1>
              <p className="max-w-xl text-lg leading-relaxed text-ink-muted">
                Play or sing into your microphone. SoundMatch names the note, shows how many cents off it is, and compares your sound with
                reference recordings, with an explanation for every score.
              </p>
              <div className="flex flex-wrap gap-3">
                <ButtonLink href={ROUTES.listen} size="lg">
                  Try the live tuner
                </ButtonLink>
                <ButtonLink href={ROUTES.signUp} size="lg" variant="secondary">
                  Create a free account
                </ButtonLink>
              </div>
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <ShieldCheck aria-hidden className="size-4 text-success" />
                No account needed for the tuner. Your audio never leaves your device.
              </p>
            </div>
            <HeroVisual />
          </div>
        </section>

        {/* Features */}
        <section aria-labelledby="features-heading" className="border-t border-line bg-surface/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 id="features-heading" className="text-3xl font-semibold tracking-tight text-ink">
              Everything happens while you play
            </h2>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <li key={title} className="flex flex-col gap-3 rounded-card border border-line bg-surface p-6 shadow-card">
                  <Icon aria-hidden className="size-6 text-brand-strong" />
                  <h3 className="font-medium text-ink">{title}</h3>
                  <p className="text-sm leading-relaxed text-ink-muted">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section aria-labelledby="how-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 id="how-heading" className="text-3xl font-semibold tracking-tight text-ink">
            How it works
          </h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex flex-col gap-3">
                <span className="flex size-9 items-center justify-center rounded-full border border-brand/50 bg-brand/10 font-mono text-sm text-brand-strong">
                  {index + 1}
                </span>
                <h3 className="font-medium text-ink">{step.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Honest results */}
        <section aria-labelledby="honest-heading" className="border-y border-line bg-surface/40">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
            <div className="flex flex-col gap-4">
              <h2 id="honest-heading" className="text-3xl font-semibold tracking-tight text-ink">
                Honest about what it measures
              </h2>
              <p className="leading-relaxed text-ink-muted">
                Scores are clearly labelled as heuristic similarity scores, not certified measurements. Each one comes with what was compared, a
                breakdown, and visuals of your sound against the reference.
              </p>
            </div>
            <ul className="flex flex-col gap-3 text-sm text-ink-muted">
              {[
                "Pitch scores are based on cents: 100 when it matches, 90 at 10 cents, 0 at a quarter-tone.",
                "Warnings when a sound was too quiet, clipped, noisy, too short or had no clear pitch.",
                "Synthetic test tones in the library are always labelled as synthetic.",
                "Every reference sound lists its license and source.",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-strong" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Use cases */}
        <section aria-labelledby="uses-heading" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <h2 id="uses-heading" className="text-3xl font-semibold tracking-tight text-ink">
            Who it&apos;s for
          </h2>
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {USE_CASES.map((useCase) => (
              <li key={useCase.title} className="rounded-card border border-line bg-surface p-6">
                <h3 className="font-medium text-ink">{useCase.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{useCase.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Final call to action */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="flex flex-col items-start gap-6 rounded-panel border border-line bg-[linear-gradient(135deg,rgb(139_123_255/0.15),rgb(34_211_238/0.08))] p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-ink">Ready to listen?</h2>
              <p className="mt-2 text-ink-muted">Start with the tuner now; create an account when you want to compare and keep a history.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={ROUTES.listen}>Open the tuner</ButtonLink>
              <ButtonLink href={ROUTES.signIn} variant="secondary">
                Sign in
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex max-w-sm flex-col gap-3">
            <Logo />
            <p className="text-sm text-ink-muted">Live sound analysis in your browser. The microphone is used only while you listen, and audio never leaves your device.</p>
          </div>
          <nav aria-label="Footer" className="flex gap-12 text-sm">
            <ul className="flex flex-col gap-2">
              <li>
                <Link href={ROUTES.listen} className="text-ink-muted hover:text-ink">
                  Live tuner
                </Link>
              </li>
              <li>
                <Link href={ROUTES.signUp} className="text-ink-muted hover:text-ink">
                  Create account
                </Link>
              </li>
              <li>
                <Link href={ROUTES.signIn} className="text-ink-muted hover:text-ink">
                  Sign in
                </Link>
              </li>
            </ul>
          </nav>
        </div>
        <p className="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink-subtle sm:px-6">© {new Date().getFullYear()} SoundMatch</p>
      </footer>
    </div>
  );
}
