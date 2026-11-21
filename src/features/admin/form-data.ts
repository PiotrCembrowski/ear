/** Form helpers shared by the admin reference forms (not Server Actions). */

export type MetadataFormState = { status: "idle" | "error" | "success"; message?: string; fieldErrors?: Record<string, string[] | undefined> };

/** Reads the reference metadata fields from a submitted form. */
export function metadataFromForm(formData: FormData): Record<string, unknown> {
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    description: text("description"),
    categoryId: text("categoryId"),
    tags: text("tags"),
    visibility: text("visibility"),
    isSynthetic: formData.get("isSynthetic") === "on",
    license: text("license"),
    sourceUrl: text("sourceUrl"),
    attribution: text("attribution"),
  };
}

