import { NextResponse, type NextRequest } from "next/server";
import { defaultRegistry } from "@/lib/audio-engine";
import { UUID_PATTERN, type InstrumentFeaturesResponse } from "@/lib/audio-browser/reference-data";
import { getSessionUser } from "@/lib/auth/session";
import { logServerError } from "@/lib/logging";
import { listInstrumentCandidates } from "@/lib/services/reference-features";
import { listInstruments, listVariants } from "@/lib/services/references";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * GET /api/instruments/:id/features?variant=…: every sample of an instrument
 * the caller may see, with its current pitch and timbre features, for
 * closest-match ranking in the browser. Samples without current features are
 * left out (and counted), so a half-analysed library still works.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await getSessionUser())) return NextResponse.json({ error: "Sign in to use closest match." }, { status: 401 });
  const variantParam = request.nextUrl.searchParams.get("variant");
  const variant = variantParam && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(variantParam) ? variantParam : null;

  try {
    const client = await createServerSupabase();
    const instrument = (await listInstruments(client)).find((i) => i.id === id);
    if (!instrument) return NextResponse.json({ error: "That instrument doesn't exist." }, { status: 404 });
    const [variants, rows] = await Promise.all([listVariants(client, id), listInstrumentCandidates(client, id, variant)]);
    const pitch = defaultRegistry.get("pitch")!;
    const timbre = defaultRegistry.get("timbre")!;
    const candidates = rows
      .filter((row) => row.features.pitch || row.features.timbre)
      .map((row) => ({
        referenceId: row.referenceId,
        name: row.name,
        noteName: row.noteName,
        midiNote: row.midiNote,
        velocity: row.velocity,
        variant: row.variant,
        isSynthetic: row.isSynthetic,
        pitch: row.features.pitch ? pitch.parseFeatures(row.features.pitch) : undefined,
        timbre: row.features.timbre ? timbre.parseFeatures(row.features.timbre) : undefined,
      }));
    const body: InstrumentFeaturesResponse = {
      instrument: { id: instrument.id, slug: instrument.slug, name: instrument.name },
      variants,
      variant,
      // Instrument samples all have notes, so pitch ranks them (timbre breaks ties).
      primary: candidates.some((c) => c.pitch) ? "pitch" : "timbre",
      candidates,
    };
    return NextResponse.json(body, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    logServerError("GET instrument features", error, { id });
    return NextResponse.json({ error: "Couldn't load the instrument's samples. Please try again." }, { status: 500 });
  }
}
