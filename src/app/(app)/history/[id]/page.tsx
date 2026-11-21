import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeleteComparisonButton } from "@/features/history/components/delete-comparison-button";
import { StoredResultView } from "@/features/history/components/stored-result-view";
import { UUID_PATTERN } from "@/lib/audio-browser/reference-data";
import { ROUTES } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { getComparison } from "@/lib/services/comparisons";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Saved result" };

export default async function HistoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireUser(`${ROUTES.history}/${id}`);
  if (!UUID_PATTERN.test(id)) notFound();
  const comparison = await getComparison(await createServerSupabase(), id);
  if (!comparison) notFound();
  const when = new Intl.DateTimeFormat("en", { dateStyle: "full", timeStyle: "short" }).format(new Date(comparison.createdAt));

  return (
    <>
      <PageHeader
        title={comparison.title}
        description={`Saved ${when}.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {comparison.mode === "compare" && comparison.referenceSoundId && (
              <ButtonLink href={`${ROUTES.listen}?mode=compare&ref=${comparison.referenceSoundId}`} variant="secondary" size="sm">
                Compare again
              </ButtonLink>
            )}
            <DeleteComparisonButton id={comparison.id} title={comparison.title} redirectTo={ROUTES.history} />
          </div>
        }
      />
      <Card className="max-w-4xl">
        <CardContent>
          <StoredResultView result={comparison.result} />
        </CardContent>
      </Card>
    </>
  );
}
