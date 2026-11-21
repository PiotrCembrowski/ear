import type { Metadata } from "next";
import { AppShell, PageHeader } from "@/components/app-shell/app-shell";
import { PublicHeader } from "@/components/app-shell/public-header";
import { ListenScreen } from "@/features/listen/components/listen-screen";
import { getCurrentProfile, getSessionUser } from "@/lib/auth/session";
import { DEFAULT_PROFILE_SETTINGS } from "@/lib/validation/profile";

export const metadata: Metadata = {
  title: "Listen",
  description: "Live note identification in your browser. Your audio never leaves your device.",
};

/**
 * The Listen screen. Identifying notes needs no account, so this page works
 * signed out too; signed-in users get it inside the app shell with their own
 * sensitivity and A4 settings.
 */
export default async function ListenPage() {
  const user = await getSessionUser();
  const profile = user ? await getCurrentProfile() : null;
  const settings = profile?.settings ?? DEFAULT_PROFILE_SETTINGS;
  const content = (
    <>
      <PageHeader
        title="Listen"
        description="Identify notes live: play or sing a single note and see its name, how many cents it is off, and how confident the measurement is."
      />
      <ListenScreen defaults={{ sensitivityDb: settings.sensitivityDb, a4Hz: settings.a4Hz }} />
    </>
  );

  if (user) {
    return <AppShell user={{ displayName: profile?.displayName ?? null, email: user.email, isAdmin: profile?.role === "admin" }}>{content}</AppShell>;
  }
  return (
    <div className="min-h-dvh">
      <PublicHeader />
      <main id="main-content" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        {content}
      </main>
    </div>
  );
}
