import Link from "next/link";
import { Logo } from "@/components/ui/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center px-4 py-10 sm:py-16">
      {/* Subtle brand glow behind the card; purely decorative. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgb(139_123_255/0.18),transparent_65%)]"
      />
      <Link href="/" className="relative mb-8 rounded-control" aria-label="SoundMatch home">
        <Logo />
      </Link>
      <main className="relative w-full max-w-md">{children}</main>
    </div>
  );
}
