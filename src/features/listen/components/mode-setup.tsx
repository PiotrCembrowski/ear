"use client";

import { FlaskConical } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectField } from "@/components/ui/fields";
import { Spinner } from "@/components/ui/spinner";
import { ROUTES, signInPathWithNext } from "@/lib/auth/routes";
import type { ListenController, ListenState } from "../listen-controller";

function SignInPrompt({ what, next }: { what: string; next: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-ink-muted">{what} uses the reference library, which needs an account. Identifying notes works without one.</p>
      <ButtonLink href={signInPathWithNext(next)} size="sm">
        Sign in
      </ButtonLink>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-ink-muted">
      <Spinner /> {text}
    </p>
  );
}

export function CompareSetup({ state, signedIn }: { state: ListenState; signedIn: boolean }) {
  const setup = state.compare;
  return (
    <Card aria-labelledby="compare-setup-heading">
      <CardHeader>
        <CardTitle id="compare-setup-heading">Reference</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!signedIn ? (
          <SignInPrompt what="Comparing" next={`${ROUTES.listen}?mode=compare`} />
        ) : setup.status === "empty" ? (
          <>
            <p className="text-sm text-ink-muted">Choose the sound to compare with. In the library, press “Compare” on any reference.</p>
            <ButtonLink href={ROUTES.library} variant="secondary" size="sm" className="self-start">
              Choose from the library
            </ButtonLink>
          </>
        ) : setup.status === "loading" ? (
          <Loading text="Loading the reference…" />
        ) : setup.status === "error" ? (
          <>
            <Alert tone="danger">{setup.message}</Alert>
            <ButtonLink href={ROUTES.library} variant="secondary" size="sm" className="self-start">
              Choose another reference
            </ButtonLink>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <p className="font-medium text-ink">{setup.reference.name}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge>{setup.reference.categoryName}</Badge>
                {setup.reference.noteName && <Badge tone="brand">{setup.reference.noteName.replace("#", "♯")}</Badge>}
                {setup.reference.isSynthetic && (
                  <Badge tone="warning">
                    <FlaskConical aria-hidden className="size-3" /> Synthetic test tone
                  </Badge>
                )}
              </div>
              <p className="text-xs text-ink-muted">
                {setup.strategyId === "pitch"
                  ? "Compared by pitch: play or sing this note. The result appears as soon as the pitch is steady."
                  : "Compared by tone colour, loudness shape and length. The result appears when your sound ends."}
              </p>
            </div>
            <ButtonLink href={ROUTES.library} variant="ghost" size="sm" className="self-start">
              Choose another reference
            </ButtonLink>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function ClosestSetup({
  state,
  controller,
  signedIn,
  instruments,
  onChange,
}: {
  state: ListenState;
  controller: ListenController;
  signedIn: boolean;
  instruments: Array<{ id: string; name: string }>;
  onChange(instrumentId: string, variant: string | null): void;
}) {
  const setup = state.closest;
  const instrumentId = setup.status === "empty" ? "" : setup.instrumentId;
  const variant = setup.status === "empty" ? null : setup.variant;
  const variants = setup.status === "ready" ? setup.variants : [];
  const select = (nextInstrument: string, nextVariant: string | null) => {
    onChange(nextInstrument, nextVariant);
    if (nextInstrument) void controller.loadInstrument(nextInstrument, nextVariant);
  };
  return (
    <Card aria-labelledby="closest-setup-heading">
      <CardHeader>
        <CardTitle id="closest-setup-heading">Instrument</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!signedIn ? (
          <SignInPrompt what="Closest match" next={`${ROUTES.listen}?mode=closest`} />
        ) : instruments.length === 0 ? (
          <p className="text-sm text-ink-muted">No instruments are set up yet.</p>
        ) : (
          <>
            <SelectField
              label="Compare with all samples of"
              name="instrument"
              value={instrumentId}
              placeholder="Choose an instrument"
              options={instruments.map((i) => ({ value: i.id, label: i.name }))}
              onChange={(e) => select(e.target.value, null)}
            />
            {variants.length > 1 && (
              <SelectField
                label="Sample set"
                name="variant"
                value={variant ?? ""}
                placeholder="All sample sets"
                options={variants.map((v) => ({ value: v, label: v }))}
                onChange={(e) => select(instrumentId, e.target.value || null)}
              />
            )}
            {setup.status === "loading" && <Loading text="Loading samples…" />}
            {setup.status === "error" && <Alert tone="danger">{setup.message}</Alert>}
            {setup.status === "ready" &&
              (setup.count === 0 ? (
                <Alert tone="warning">This instrument has no analysed samples yet. An admin can import a sample set.</Alert>
              ) : (
                <p className="text-sm text-ink-muted">
                  {setup.count} sample{setup.count === 1 ? "" : "s"} ready. Play one note; the five closest samples appear as soon as its pitch is
                  steady.
                </p>
              ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}
