import { Pencil, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { DeleteReferenceButton } from "@/features/admin/components/delete-reference-button";
import { RecomputePanel } from "@/features/admin/components/recompute-panel";
import { NoticeBanner } from "@/features/auth/components/notice-banner";
import { LibraryFilters } from "@/features/library/components/library-filters";
import { ReferenceCard } from "@/features/library/components/reference-card";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdmin } from "@/lib/auth/session";
import { listOutdatedReferenceIds } from "@/lib/services/reference-features";
import { listCategories, listInstruments, searchReferences, signedAudioUrls } from "@/lib/services/references";
import { createServerSupabase } from "@/lib/supabase/server";
import { readLibraryParams } from "@/lib/validation/library";

export const metadata: Metadata = { title: "Manage references" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminReferencesPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin(ROUTES.adminReferences);
  const raw = await searchParams;
  const params = readLibraryParams(raw);
  const client = await createServerSupabase();
  const [categories, instruments, outdated] = await Promise.all([listCategories(client), listInstruments(client), listOutdatedReferenceIds(client)]);
  const category = categories.find((c) => c.slug === params.category);
  const instrument = instruments.find((i) => i.slug === params.instrument);
  const result = await searchReferences(client, { query: params.q, categoryId: category?.id, instrumentId: instrument?.id, page: params.page });
  const audioUrls = await signedAudioUrls(client, result.items.map((r) => r.storagePath));

  return (
    <>
      <PageHeader
        title="Manage references"
        description="Add, edit and delete reference sounds, and import instrument sample sets. Private references are visible to you and other admins only."
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={ROUTES.adminImport} variant="secondary">
              <Upload aria-hidden className="size-4" />
              Bulk import samples
            </ButtonLink>
            <ButtonLink href={ROUTES.adminNewReference}>Add reference</ButtonLink>
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        <NoticeBanner notice={raw.notice} />
        <RecomputePanel outdatedCount={outdated.length} />
        <LibraryFilters action={ROUTES.adminReferences} params={params} categories={categories} instruments={instruments} />
        <p className="text-sm text-ink-muted">{result.total === 1 ? "1 reference" : `${result.total} references`}</p>
        {result.items.length === 0 ? (
          <Card>
            <CardContent>
              <p className="text-sm text-ink-muted">No references found. Add one, or import an instrument sample set.</p>
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
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <Link
                      href={`${ROUTES.adminReferences}/${reference.id}`}
                      className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-sm text-ink-muted hover:bg-surface-raised hover:text-ink"
                      aria-label={`Edit ${reference.name}`}
                    >
                      <Pencil aria-hidden className="size-4" />
                      Edit
                    </Link>
                    <DeleteReferenceButton referenceId={reference.id} name={reference.name} />
                  </div>
                }
              />
            ))}
          </div>
        )}
        <Pagination
          page={result.page}
          pageSize={result.pageSize}
          total={result.total}
          basePath={ROUTES.adminReferences}
          params={{ q: params.q, category: params.category, instrument: params.instrument }}
        />
      </div>
    </>
  );
}
