import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { AuthCard } from "@/features/auth/components/auth-card";
import { UpdatePasswordForm } from "@/features/auth/components/update-password-form";
import { ROUTES } from "@/lib/auth/routes";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Reached from the password-reset email: /auth/confirm verifies the link,
 * signs the user in, and redirects here.
 */
export default async function UpdatePasswordPage() {
  const user = await getSessionUser();

  if (!user) {
    return (
      <AuthCard title="Link expired">
        <div className="flex flex-col gap-4">
          <Alert tone="warning">
            This page only works right after opening a password-reset link, and that link has expired or was already used.
          </Alert>
          <Link href={ROUTES.resetPassword} className="font-medium text-brand-strong hover:underline">
            Request a new reset link
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password" description={user.email ? `For ${user.email}.` : undefined}>
      <UpdatePasswordForm />
    </AuthCard>
  );
}
