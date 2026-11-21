import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/features/auth/components/auth-card";
import { SignUpForm } from "@/features/auth/components/sign-up-form";
import { ROUTES } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create your account"
      description="Free. Your audio is analysed in your browser and never uploaded; only result summaries are saved to your history."
      footer={
        <>
          Already have an account?{" "}
          <Link href={ROUTES.signIn} className="font-medium text-brand-strong hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthCard>
  );
}
