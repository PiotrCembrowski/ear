import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app-shell/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SelectField } from "@/components/ui/fields";
import { Pagination } from "@/components/ui/pagination";
import { TextField } from "@/components/ui/text-field";
import { scoreBand } from "@/features/comparison/components/score-badge";
import { DeleteComparisonButton } from "@/features/history/components/delete-comparison-button";
import { ROUTES } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { listComparisons } from "@/lib/services/comparisons";
import type { ComparisonMode } from "@/lib/supabase/database.types";
import { createServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "History" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MODE_LABEL: Record<ComparisonMode, string> = { compare: "Compare", closest: "Closest match", identify: "Note" };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function HistoryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser(ROUTES.history);
  const raw = await searchParams;
  const q = first(raw.q)?.slice(0, 100);
  const modeParam = first(raw.mode);
  const mode = modeParam === "compare" || modeParam === "closest" || modeParam === "identify" ? modeParam : undefined;
  const page = Math.max(1, Math.min(10_000, Number(first(raw.page)) || 1));
  const result = await listComparisons(await createServerSupabase(), { query: q, mode, page });
  const filtered = Boolean(q || mode);
  const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <PageHeader
        title="History"
        description="Your saved results. Only summaries are stored (scores, notes and measurements), never audio. You can turn saving off in Settings."
      />
      <div className="flex flex-col gap-6">
        <form action={ROUTES.history} method="get" role="search" className="grid gap-4 rounded-card border border-line bg-surface p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <TextField label="Search" name="q" type="search" defaultValue={q} placeholder="Note or reference name" maxLength={100} />
          <SelectField
            label="Type"
            name="mode"
            defaultValue={mode ?? ""}
            placeholder="All results"
            options={[
              { value: "compare", label: "Compare" },
              { value: "closest", label: "Closest match" },
              { value: "identify", label: "Saved notes" },
            ]}
          />
          <Button type="submit" variant="secondary" className="h-11">
            Filter
          </Button>
        </form>

        {result.items.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-start gap-3">
              <p className="font-medium text-ink">{filtered ? "No results match." : "No saved results yet."}</p>
              <p className="text-sm text-ink-muted">
                {filtered ? "Try another search or clear the filter." : "Compare a sound with a reference on the Listen screen, and the result is saved here."}
              </p>
              <ButtonLink href={filtered ? ROUTES.history : ROUTES.listen} variant="secondary" size="sm">
                {filtered ? "Clear filter" : "Go to Listen"}
              </ButtonLink>
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface" aria-label="Saved results">
            {result.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Link href={`${ROUTES.history}/${item.id}`} className="truncate font-medium text-ink hover:underline">
                    {item.title}
                  </Link>
                  <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                    <Badge>{MODE_LABEL[item.mode]}</Badge>
                    <time dateTime={item.createdAt}>{dateFormat.format(new Date(item.createdAt))}</time>
                  </p>
                </div>
                {item.score !== null && (
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-lg text-ink tabular-nums">{Math.round(item.score)}</span>
                    <span className={`text-xs ${scoreBand(item.score).tone}`}>{scoreBand(item.score).label}</span>
                  </span>
                )}
                <DeleteComparisonButton id={item.id} title={item.title} />
              </li>
            ))}
          </ul>
        )}
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} basePath={ROUTES.history} params={{ q, mode }} />
      </div>
    </>
  );
}
