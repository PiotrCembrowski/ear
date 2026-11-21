import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { ROUTES } from "@/lib/auth/routes";

/** Header for signed-out visitors: logo and account links. */
export function PublicHeader() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-5 sm:px-6">
      <Link href="/" className="rounded-control" aria-label="SoundMatch home">
        <Logo compact />
      </Link>
      <nav aria-label="Main" className="flex items-center gap-1 sm:gap-2">
        <ButtonLink href={ROUTES.listen} variant="ghost" size="sm">
          Tuner
        </ButtonLink>
        <ButtonLink href={ROUTES.signIn} variant="ghost" size="sm">
          Sign in
        </ButtonLink>
        <ButtonLink href={ROUTES.signUp} size="sm">
          Create account
        </ButtonLink>
      </nav>
    </header>
  );
}
