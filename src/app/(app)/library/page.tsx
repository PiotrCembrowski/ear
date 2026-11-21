import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { LibraryFilters } from "@/features/library/components/library-filters";
import { ReferenceCard } from "@/features/library/components/reference-card";
import { ROUTES } from "@/lib/auth/routes";
import { getCurrentProfile, requireUser } from "@/lib/auth/session";
import { listCategories, listInstruments, searchReferences, signedAudioUrls } from "@/lib/services/references";
import { createServerSupabase } from "@/lib/supabase/server";
import { readLibraryParams } from "@/lib/validation/library";

export const metadata: Metadata = { title: "Library" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser(ROUTES.library);
  const params = readLibraryParams(await searchParams);
  const client = await createServerSupabase();
  const [categories, instruments, profile] = await Promise.all([listCategories(client), listInstruments(client), getCurrentProfile()]);
  const category = categories.find((c) => c.slug === params.category);
  const instrument = instruments.find((i) => i.slug === params.instrument);

  const result = await searchReferences(client, { query: params.q, categoryId: category?.id, instrumentId: instrument?.id, page: params.page });
  const audioUrls = await signedAudioUrls(client, result.items.map((r) => r.storagePath));
  const filtered = Boolean(params.q || category || instrument);

  return (
    <>
      <PageHeader
        title="Reference library"
        description="Browse the sounds and instrument notes you can compare with. Preview any of them, then press Compare and play your own version."
      />
      <div className="flex flex-col gap-6">
        <LibraryFilters action={ROUTES.library} params={params} categories={categories} instruments={instruments} />

        <p className="text-sm text-ink-muted" aria-live="polite">
          {result.total === 1 ? "1 sound" : `${result.total} sounds`}
          {filtered ? " match your search." : " in the library."}
        </p>

        {result.items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3">
              <p className="font-medium text-ink">{filtered ? "No sounds match your search." : "The library is empty."}</p>
              <p className="text-sm text-ink-muted">
                {filtered
                  ? "Try fewer words, or clear the category and instrument filters."
                  : profile?.role === "admin"
                    ? "Add reference sounds or import an instrument sample set from the admin area."
                    : "An administrator hasn't added any reference sounds yet."}
              </p>
              {filtered ? (
                <ButtonLink href={ROUTES.library} variant="secondary" size="sm">
                  Clear search
                </ButtonLink>
              ) : (
                profile?.role === "admin" && (
                  <ButtonLink href={ROUTES.adminReferences} variant="secondary" size="sm">
                    Go to admin
                  </ButtonLink>
                )
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {result.items.map((reference) => (
              <ReferenceCard
                key={reference.id}
                reference={reference}
                audioUrl={audioUrls.get(reference.storagePath) ?? null}
                actions={
                  <ButtonLink href={`${ROUTES.listen}?mode=compare&ref=${reference.id}`} size="sm" className="self-start" aria-label={`Compare with ${reference.name}`}>
                    Compare
                  </ButtonLink>
                }
              />
            ))}
          </div>
        )}

        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          basePath={ROUTES.library}
          params={{ q: params.q, category: params.category, instrument: params.instrument }}
        />
      </div>
    </>
  );
}
