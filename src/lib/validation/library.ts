import { z } from "zod";

/** Library URL parameters (?q=&category=&instrument=&page=). Invalid values are ignored, not errors. */
export const librarySearchParamsSchema = z.object({
  q: z.string().max(100).optional().catch(undefined),
  category: z.string().regex(/^[a-z0-9-]{1,60}$/).optional().catch(undefined),
  instrument: z.string().regex(/^[a-z0-9-]{1,60}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

export type LibrarySearchParams = z.infer<typeof librarySearchParamsSchema>;

export function readLibraryParams(raw: Record<string, string | string[] | undefined>): LibrarySearchParams {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined;
  return librarySearchParamsSchema.parse({ q: first(raw.q), category: first(raw.category), instrument: first(raw.instrument), page: first(raw.page) });
}
