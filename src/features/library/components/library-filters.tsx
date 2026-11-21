import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/fields";
import { TextField } from "@/components/ui/text-field";
import type { Category, Instrument } from "@/lib/services/references";
import type { LibrarySearchParams } from "@/lib/validation/library";

/** A plain GET form: works without JavaScript and keeps results shareable by URL. */
export function LibraryFilters({
  action,
  params,
  categories,
  instruments,
}: {
  action: string;
  params: LibrarySearchParams;
  categories: Category[];
  instruments: Instrument[];
}) {
  return (
    <form action={action} method="get" role="search" className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1fr_12rem_12rem_auto] sm:items-end">
      <TextField label="Search" name="q" type="search" defaultValue={params.q} placeholder="Name, description or tag" maxLength={100} />
      <SelectField
        label="Category"
        name="category"
        defaultValue={params.category ?? ""}
        placeholder="All categories"
        options={categories.map((c) => ({ value: c.slug, label: c.name }))}
      />
      <SelectField
        label="Instrument"
        name="instrument"
        defaultValue={params.instrument ?? ""}
        placeholder="Any"
        options={instruments.map((i) => ({ value: i.slug, label: i.name }))}
      />
      <Button type="submit" variant="secondary" className="h-11">
        <Search aria-hidden className="size-4" />
        Search
      </Button>
    </form>
  );
}
