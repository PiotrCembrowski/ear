"use client";

import { useEffect } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Error boundary for public pages (signed-in pages have their own in the (app) group). */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 px-6">
      <Alert tone="danger" title="Something went wrong">
        This page couldn&apos;t be shown. Please try again.
        {error.digest && <span className="mt-1 block text-xs text-ink-subtle">Reference: {error.digest}</span>}
      </Alert>
      <Button variant="secondary" className="self-start" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
