import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { NoticeBanner } from "@/features/auth/components/notice-banner";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Reset password" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you signed up with and we'll send you a link to choose a new password."
      footer={
        <Link href={ROUTES.signIn} className="font-medium text-brand-strong hover:underline">
          Back to sign in
        </Link>
      }
    >
      <div className="flex flex-col gap-5">
        <NoticeBanner notice={params.notice} />
        <ResetPasswordForm />
      </div>
    </AuthCard>
  );
}
