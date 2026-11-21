import { AudioLines, History, Library } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeBanner } from "@/features/auth/components/notice-banner";
import { scoreBand } from "@/features/comparison/components/score-badge";
import { ROUTES } from "@/lib/auth/routes";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";
import { listComparisons } from "@/lib/services/comparisons";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const ACTIONS = [
  { href: ROUTES.listen, icon: AudioLines, title: "Identify a note", text: "Live tuner: note name, cents and confidence." },
  { href: ROUTES.library, icon: Library, title: "Compare with a reference", text: "Pick a sound in the library and play your version." },
  { href: ROUTES.history, icon: History, title: "Review your history", text: "Every saved result, searchable." },
];

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser(ROUTES.dashboard);
  const [profile, params, recent] = await Promise.all([
    getCurrentProfile(),
    searchParams,
    createServerSupabase().then((client) => listComparisons(client, { pageSize: 3 })),
  ]);
  const name = profile?.displayName ?? user.email ?? "there";

  return (
    <>
      <div className="mb-6">
        <NoticeBanner notice={params.notice} />
      </div>
      <PageHeader title={`Hello, ${name}`} description="What would you like to listen to?" />

      <div className="flex flex-col gap-6">
        <ul className="grid gap-4 md:grid-cols-3">
          {ACTIONS.map(({ href, icon: Icon, title, text }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex h-full flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card transition-colors hover:border-line-strong hover:bg-surface-raised"
              >
                <Icon aria-hidden className="size-6 text-brand-strong" />
                <span className="font-medium text-ink">{title}</span>
                <span className="text-sm text-ink-muted">{text}</span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
          <Card aria-labelledby="recent-heading">
            <CardHeader>
              <CardTitle id="recent-heading">Recent results</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.items.length === 0 ? (
                <p className="text-sm text-ink-muted">Nothing saved yet. Results from Compare and Closest match appear here.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {recent.items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-4 py-2.5">
                      <Link href={`${ROUTES.history}/${item.id}`} className="truncate text-sm text-ink hover:underline">
                        {item.title}
                      </Link>
                      {item.score !== null && (
                        <span className="shrink-0 font-mono text-sm text-ink tabular-nums">
                          {Math.round(item.score)} <span className={`text-xs ${scoreBand(item.score).tone}`}>{scoreBand(item.score).label}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {recent.total > 3 && (
                <ButtonLink href={ROUTES.history} variant="ghost" size="sm" className="mt-3">
                  All {recent.total} results
                </ButtonLink>
              )}
            </CardContent>
          </Card>

          <Card aria-labelledby="account-heading">
            <CardHeader>
              <CardTitle id="account-heading">Your settings</CardTitle>
              <CardDescription>{user.email ?? "Signed in"}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-ink-muted">Reference pitch</dt>
                <dd className="font-mono text-ink">A4 = {profile?.settings.a4Hz ?? 440} Hz</dd>
                <dt className="text-ink-muted">Sensitivity</dt>
                <dd className="font-mono text-ink">{profile?.settings.sensitivityDb ?? 12} dB</dd>
                <dt className="text-ink-muted">History</dt>
                <dd className="text-ink">{profile?.settings.saveHistory === false ? "Not saved automatically" : "Saved automatically"}</dd>
              </dl>
              <ButtonLink href={ROUTES.settings} variant="secondary" size="sm" className="mt-5">
                Change settings
              </ButtonLink>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
