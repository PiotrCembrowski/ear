"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { deleteComparisonAction } from "../actions";

/** Two-step delete for a history entry. */
export function DeleteComparisonButton({ id, title, redirectTo }: { id: string; title: string; redirectTo?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    const result = await deleteComparisonAction(id);
    setBusy(false);
    if (!result.ok) return setError(result.message ?? "Couldn't delete it.");
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Delete “${title}” from history`}>
        <Trash2 aria-hidden className="size-4" />
        Delete
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Confirm deleting “${title}”`} className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink">Delete this result?</span>
      <Button variant="danger" size="sm" onClick={() => void confirm()} disabled={busy}>
        {busy && <Spinner />}
        Delete
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy} autoFocus>
        Cancel
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
