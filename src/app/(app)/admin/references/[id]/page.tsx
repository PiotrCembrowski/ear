import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app-shell/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteReferenceButton } from "@/features/admin/components/delete-reference-button";
import { EditReferenceForm } from "@/features/admin/components/edit-reference-form";
import { formatDuration, ReferenceBadges } from "@/features/library/components/reference-card";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdmin } from "@/lib/auth/session";
import { getReference, listCategories, signedAudioUrls } from "@/lib/services/references";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Edit reference" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditReferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin(`${ROUTES.adminReferences}/${id}`);
  if (!UUID.test(id)) notFound();
  const client = await createServerSupabase();
  const [reference, categories] = await Promise.all([getReference(client, id), listCategories(client)]);
  if (!reference) notFound();
  const audioUrl = (await signedAudioUrls(client, [reference.storagePath])).get(reference.storagePath) ?? null;

  return (
    <>
      <PageHeader title="Edit reference" description={reference.name} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardContent>
            <EditReferenceForm
              referenceId={reference.id}
              categories={categories}
              defaults={{
                name: reference.name,
                description: reference.description,
                categoryId: reference.category.id,
                tags: reference.tags,
                visibility: reference.visibility,
                license: reference.license,
                sourceUrl: reference.sourceUrl,
                attribution: reference.attribution,
                isSynthetic: reference.isSynthetic,
              }}
            />
          </CardContent>
        </Card>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Audio file</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ReferenceBadges reference={reference} />
              {audioUrl && <audio controls preload="none" src={audioUrl} className="h-9 w-full" aria-label={`Preview ${reference.name}`} />}
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                <dt className="text-ink-muted">Length</dt>
                <dd className="font-mono text-ink">{formatDuration(reference.durationMs)}</dd>
                <dt className="text-ink-muted">Format</dt>
                <dd className="font-mono text-ink">WAV, mono, {(reference.sampleRate / 1000).toFixed(1)} kHz</dd>
                <dt className="text-ink-muted">Stored as</dt>
                <dd className="font-mono break-all text-ink">{reference.storagePath}</dd>
                {reference.sample && (
                  <>
                    <dt className="text-ink-muted">Sample</dt>
                    <dd className="text-ink">
                      {reference.sample.instrumentName} {reference.sample.noteName}, variant {reference.sample.variant}
                      {reference.sample.velocity !== null && `, velocity ${reference.sample.velocity}`}
                    </dd>
                  </>
                )}
              </dl>
              <p className="text-xs text-ink-subtle">To replace the audio or change the note, delete this reference and import it again.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delete</CardTitle>
            </CardHeader>
            <CardContent>
              <DeleteReferenceButton referenceId={reference.id} name={reference.name} redirectAfter />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
