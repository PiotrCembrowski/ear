import { NextResponse } from "next/server";
import { defaultRegistry } from "@/lib/audio-engine";
import { UUID_PATTERN, type ReferenceFeaturesResponse } from "@/lib/audio-browser/reference-data";
import { getSessionUser } from "@/lib/auth/session";
import { logServerError } from "@/lib/logging";
import { getCurrentFeatures, referenceMeta } from "@/lib/services/reference-features";
import { getReference } from "@/lib/services/references";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/references/:id/features: the features the browser needs to
 * compare live sound with this reference (for the strategy the registry picks).
 * Row Level Security decides whether the caller may see the reference.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await getSessionUser())) return NextResponse.json({ error: "Sign in to compare with references." }, { status: 401 });

  try {
    const client = await createServerSupabase();
    const reference = await getReference(client, id);
    if (!reference) return NextResponse.json({ error: "That reference doesn't exist or isn't available to you." }, { status: 404 });
    const strategy = defaultRegistry.pickFor(referenceMeta(reference));
    const features = await getCurrentFeatures(client, id, strategy.id);
    if (!features) {
      return NextResponse.json({ error: "This reference hasn't been analysed with the current engine yet. An admin can recompute it." }, { status: 409 });
    }
    const body: ReferenceFeaturesResponse = {
      reference: {
        id: reference.id,
        name: reference.name,
        categoryName: reference.category.name,
        noteName: reference.sample?.noteName ?? null,
        velocity: reference.sample?.velocity ?? null,
        variant: reference.sample?.variant ?? null,
        isSynthetic: reference.isSynthetic,
        durationMs: reference.durationMs,
      },
      strategyId: strategy.id,
      features: strategy.parseFeatures(features),
    };
    // Per user (private), short-lived: visibility can change.
    return NextResponse.json(body, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    logServerError("GET reference features", error, { id });
    return NextResponse.json({ error: "Couldn't load the reference. Please try again." }, { status: 500 });
  }
}
