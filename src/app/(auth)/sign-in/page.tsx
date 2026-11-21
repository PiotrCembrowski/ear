import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { NoticeBanner } from "@/features/auth/components/notice-banner";
import { SignInForm } from "@/features/auth/components/sign-in-form";
import { ROUTES, safeRedirectPath } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeRedirectPath(typeof params.next === "string" ? params.next : null);

  return (
    <AuthCard
      title="Sign in"
      description="Welcome back. Sign in to compare sounds and see your history."
      footer={
        <>
          New to SoundMatch?{" "}
          <Link href={ROUTES.signUp} className="font-medium text-brand-strong hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <NoticeBanner notice={params.notice} />
        <SignInForm next={next} />
      </div>
    </AuthCard>
  );
}
