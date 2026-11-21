import { LogOut } from "lucide-react";
import type { ButtonVariant } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { signOutAction } from "../actions";

/** A real form, so signing out also works before JavaScript has loaded. */
export function SignOutButton({ fullWidth = false, variant = "ghost" }: { fullWidth?: boolean; variant?: ButtonVariant }) {
  return (
    <form action={signOutAction}>
      <SubmitButton variant={variant} pendingLabel="Signing out…" fullWidth={fullWidth} className={fullWidth ? "justify-start" : undefined}>
        <LogOut aria-hidden className="size-4" />
        Sign out
      </SubmitButton>
    </form>
  );
}
