import { CheckboxField, SelectField, TextAreaField } from "@/components/ui/fields";
import { TextField } from "@/components/ui/text-field";
import type { Category } from "@/lib/services/references";

export type MetadataDefaults = {
  name?: string;
  description?: string | null;
  categoryId?: string;
  tags?: string[];
  visibility?: "public" | "private";
  license?: string;
  sourceUrl?: string | null;
  attribution?: string | null;
  isSynthetic?: boolean;
};

/** The fields every reference sound has. Shared by the "add" and "edit" forms. */
export function ReferenceMetadataFields({
  categories,
  defaults = {},
  errors = {},
  disabled,
}: {
  categories: Category[];
  defaults?: MetadataDefaults;
  errors?: Record<string, string[] | undefined>;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-5">
      <TextField label="Name" name="name" required maxLength={120} defaultValue={defaults.name} errors={errors.name} />
      <TextAreaField
        label="Description (optional)"
        name="description"
        maxLength={2000}
        rows={3}
        defaultValue={defaults.description ?? ""}
        errors={errors.description}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          label="Category"
          name="categoryId"
          required
          defaultValue={defaults.categoryId ?? ""}
          placeholder="Choose a category"
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          errors={errors.categoryId}
        />
        <SelectField
          label="Visibility"
          name="visibility"
          defaultValue={defaults.visibility ?? "public"}
          options={[
            { value: "public", label: "Public: every signed-in user" },
            { value: "private", label: "Private: you and other admins" },
          ]}
          errors={errors.visibility}
        />
      </div>
      <TextField
        label="Tags (optional)"
        name="tags"
        hint="Comma-separated, e.g. dog, bark, outdoor."
        defaultValue={defaults.tags?.join(", ")}
        errors={errors.tags}
      />
      <fieldset className="flex flex-col gap-5 rounded-control border border-line p-4">
        <legend className="px-1 text-sm font-medium text-ink">Source and license (required)</legend>
        <TextField
          label="License"
          name="license"
          required
          maxLength={200}
          hint="For example CC0-1.0, CC-BY-4.0, or “Recorded by us, all rights reserved”."
          defaultValue={defaults.license}
          errors={errors.license}
        />
        <TextField label="Source link" name="sourceUrl" type="url" maxLength={500} defaultValue={defaults.sourceUrl ?? ""} errors={errors.sourceUrl} />
        <TextField
          label="Attribution"
          name="attribution"
          maxLength={500}
          hint="Who made the recording, as the license requires. A source link or an attribution is required."
          defaultValue={defaults.attribution ?? ""}
          errors={errors.attribution}
        />
      </fieldset>
      <CheckboxField
        label="This is a synthetic test tone, not a real recording"
        name="isSynthetic"
        defaultChecked={defaults.isSynthetic}
        hint="Synthetic sounds are clearly labelled everywhere in the app. Use only for testing."
      />
    </fieldset>
  );
}
