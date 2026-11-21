import type { Metadata } from "next";
import { AppShell, PageHeader } from "@/components/app-shell/app-shell";
import { PublicHeader } from "@/components/app-shell/public-header";
import { ListenScreen, type ListenInitial } from "@/features/listen/components/listen-screen";
import { UUID_PATTERN } from "@/lib/audio-browser/reference-data";
import { getCurrentProfile, getSessionUser } from "@/lib/auth/session";
import { listInstruments } from "@/lib/services/references";
import { createServerSupabase } from "@/lib/supabase/server";
import { DEFAULT_PROFILE_SETTINGS } from "@/lib/validation/profile";

export const metadata: Metadata = {
  title: "Listen",
  description: "Live note identification and sound comparison in your browser. Your audio never leaves your device.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** Reads ?mode=&ref=&instrument=&variant= (invalid values are ignored). */
function readInitial(params: Record<string, string | string[] | undefined>): ListenInitial {
  const mode = first(params.mode);
  const ref = first(params.ref);
  const instrument = first(params.instrument);
  const variant = first(params.variant);
  return {
    mode: mode === "compare" || mode === "closest" ? mode : ref ? "compare" : "identify",
    referenceId: ref && UUID_PATTERN.test(ref) ? ref : null,
    instrumentId: instrument && UUID_PATTERN.test(instrument) ? instrument : null,
    variant: variant && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(variant) ? variant : null,
  };
}

/**
 * The Listen screen. Identifying notes needs no account, so this page works
 * signed out too; comparing and closest match use the reference library and
 * need sign-in. Signed-in users get their own sensitivity, A4 and
 * save-history settings.
 */
export default async function ListenPage({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  const profile = user ? await getCurrentProfile() : null;
  const instruments = user ? (await listInstruments(await createServerSupabase())).map((i) => ({ id: i.id, name: i.name })) : [];
  const settings = profile?.settings ?? DEFAULT_PROFILE_SETTINGS;
  const content = (
    <>
      <PageHeader
        title="Listen"
        description="Play or sing into your microphone. Identify notes live, compare a sound with a reference, or find the closest instrument sample."
      />
      <ListenScreen
        defaults={{ sensitivityDb: settings.sensitivityDb, a4Hz: settings.a4Hz, signedIn: Boolean(user), saveHistory: settings.saveHistory }}
        initial={readInitial(params)}
        instruments={instruments}
      />
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
