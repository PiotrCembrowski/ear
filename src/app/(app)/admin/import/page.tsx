import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/app-shell";
import { ImportWizard } from "@/features/admin/import/import-wizard";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdmin } from "@/lib/auth/session";
import { listInstruments } from "@/lib/services/references";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Import samples" };

export default async function ImportPage() {
  await requireAdmin(ROUTES.adminImport);
  const instruments = await listInstruments(await createServerSupabase());
  return (
    <>
      <PageHeader
        title="Import instrument samples"
        description="Import a sample set, e.g. 88 piano notes. Files are checked and previewed first; each one is then converted in your browser, uploaded and analysed. Only import recordings you have the right to use."
      />
      <ImportWizard instruments={instruments} />
    </>
  );
}
