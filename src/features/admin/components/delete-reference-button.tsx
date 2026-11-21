"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ROUTES } from "@/lib/auth/routes";
import { deleteReferenceAction } from "../actions";

/** Two-step delete: the first click asks for confirmation. */
export function DeleteReferenceButton({ referenceId, name, redirectAfter = false }: { referenceId: string; name: string; redirectAfter?: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    const result = await deleteReferenceAction(referenceId);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setConfirming(false);
    if (redirectAfter) router.push(`${ROUTES.adminReferences}?notice=reference-deleted`);
    else router.refresh();
  }

  if (!confirming) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Delete ${name}`}>
        <Trash2 aria-hidden className="size-4" />
        Delete
      </Button>
    );
  }
  return (
    <div role="group" aria-label={`Confirm deleting ${name}`} className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-ink">Delete permanently? Comparisons keep their saved summary.</span>
      <Button variant="danger" size="sm" onClick={() => void confirmDelete()} disabled={busy}>
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
