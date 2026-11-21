import { ButtonLink } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-start justify-center gap-5 px-6">
      <Logo />
      <h1 className="text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-ink-muted">That page doesn&apos;t exist, or it may have moved.</p>
      <ButtonLink href="/" variant="secondary">
        Go to the home page
      </ButtonLink>
    </main>
  );
}
