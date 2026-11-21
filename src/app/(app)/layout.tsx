import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { ROUTES } from "@/lib/auth/routes";
import { getCurrentProfile, getSessionUser } from "@/lib/auth/session";

/**
 * Layout for signed-in pages. It loads the user for the sidebar; each page
 * ALSO calls requireUser(), because Next.js doesn't re-run layouts on every
 * client-side navigation, so a layout check alone isn't a security boundary.
 */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect(ROUTES.signIn);
  const profile = await getCurrentProfile();

  return <AppShell user={{ displayName: profile?.displayName ?? null, email: user.email, isAdmin: profile?.role === "admin" }}>{children}</AppShell>;
}
