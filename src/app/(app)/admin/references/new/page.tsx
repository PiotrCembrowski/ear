import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { NewReferenceForm } from "@/features/admin/components/new-reference-form";
import { ROUTES } from "@/lib/auth/routes";
import { requireAdmin } from "@/lib/auth/session";
import { listCategories } from "@/lib/services/references";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Add reference" };

export default async function NewReferencePage() {
  await requireAdmin(ROUTES.adminNewReference);
  const categories = await listCategories(await createServerSupabase());
  return (
    <>
      <PageHeader
        title="Add a reference sound"
        description="For single sounds (a bark, a door, a clap). For instrument notes, use Bulk import, which links each file to its note."
      />
      <Card className="max-w-3xl">
        <CardContent>
          <NewReferenceForm categories={categories} />
        </CardContent>
      </Card>
    </>
  );
}
