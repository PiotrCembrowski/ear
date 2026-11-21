import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NoticeBanner } from "@/features/auth/components/notice-banner";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { UpdatePasswordForm } from "@/features/auth/components/update-password-form";
import { DeleteAccountForm } from "@/features/settings/components/delete-account-form";
import { InputDevicePreference } from "@/features/settings/components/input-device-preference";
import { ListeningDefaultsForm } from "@/features/settings/components/listening-defaults-form";
import { ProfileForm } from "@/features/settings/components/profile-form";
import { ROUTES } from "@/lib/auth/routes";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";
import { DEFAULT_PROFILE_SETTINGS } from "@/lib/validation/profile";

export const metadata: Metadata = { title: "Settings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser(ROUTES.settings);
  const [profile, params] = await Promise.all([getCurrentProfile(), searchParams]);

  return (
    <>
      <PageHeader title="Settings" description="Your profile, listening defaults, password and account." />
      <div className="flex max-w-3xl flex-col gap-6">
        <NoticeBanner notice={params.notice} />

        <Card aria-labelledby="profile-heading">
          <CardHeader>
            <CardTitle id="profile-heading">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm email={user.email} displayName={profile?.displayName ?? null} />
          </CardContent>
        </Card>

        <Card aria-labelledby="listening-heading">
          <CardHeader>
            <CardTitle id="listening-heading">Listening</CardTitle>
            <CardDescription>Defaults for the Listen screen. You can still change sensitivity while listening.</CardDescription>
          </CardHeader>
          <CardContent>
            <ListeningDefaultsForm settings={profile?.settings ?? DEFAULT_PROFILE_SETTINGS} />
          </CardContent>
        </Card>

        <Card aria-labelledby="device-heading">
          <CardHeader>
            <CardTitle id="device-heading">Default microphone</CardTitle>
          </CardHeader>
          <CardContent>
            <InputDevicePreference />
          </CardContent>
        </Card>

        <Card aria-labelledby="password-heading">
          <CardHeader>
            <CardTitle id="password-heading">Password</CardTitle>
            <CardDescription>Choose a new password for signing in.</CardDescription>
          </CardHeader>
          <CardContent>
            <UpdatePasswordForm submitLabel="Change password" />
          </CardContent>
        </Card>

        <Card aria-labelledby="session-heading">
          <CardHeader>
            <CardTitle id="session-heading">Session</CardTitle>
            <CardDescription>Sign out of SoundMatch on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <SignOutButton variant="secondary" />
          </CardContent>
        </Card>

        <Card aria-labelledby="delete-heading" className="border-danger/40">
          <CardHeader>
            <CardTitle id="delete-heading" className="text-danger">
              Delete account
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DeleteAccountForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
