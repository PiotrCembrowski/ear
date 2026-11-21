"use client";

import { useEffect } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Shown when a signed-in page fails to load. Details stay in the logs. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Alert tone="danger" title="This page couldn't be loaded">
        Something went wrong on our side. Your data is safe. Please try again.
        {error.digest && <span className="mt-1 block text-xs text-ink-subtle">Reference: {error.digest}</span>}
      </Alert>
      <Button variant="secondary" className="self-start" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
