import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeBanner } from "@/features/auth/components/notice-banner";
import { ROUTES } from "@/lib/auth/routes";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Dashboard" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser(ROUTES.dashboard);
  const [profile, params] = await Promise.all([getCurrentProfile(), searchParams]);
  const name = profile?.displayName ?? user.email ?? "there";

  return (
    <>
      <div className="mb-6">
        <NoticeBanner notice={params.notice} />
      </div>
      <PageHeader title={`Hello, ${name}`} description="Your SoundMatch home." />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Your account</CardTitle>
            <CardDescription>Signed in as {user.email ?? "an account without an email"}.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-ink-muted">Display name</dt>
              <dd className="text-ink">{profile?.displayName ?? "Not set"}</dd>
              <dt className="text-ink-muted">Reference pitch</dt>
              <dd className="font-mono text-ink">A4 = {profile?.settings.a4Hz ?? 440} Hz</dd>
              <dt className="text-ink-muted">Role</dt>
              <dd className="text-ink">{profile?.role === "admin" ? "Admin" : "Member"}</dd>
            </dl>
            <ButtonLink href={ROUTES.settings} variant="secondary" size="sm" className="mt-5">
              Edit profile
            </ButtonLink>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>What&apos;s coming</CardTitle>
            <CardDescription>SoundMatch is being built in stages.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-ink-muted">
              The live Listen screen (note identification, comparison and closest match), the reference library and your
              history are next. They&apos;ll appear in the menu as soon as they&apos;re ready.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
