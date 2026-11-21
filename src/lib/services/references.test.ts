/**
 * Service logic tests with a tiny fake Supabase client that records the
 * query it was asked to build and returns canned rows.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PITCH_STRATEGY_VERSION, TIMBRE_STRATEGY_VERSION } from "@/lib/audio-engine";
import type { Database } from "@/lib/supabase/database.types";
import { listOutdatedReferenceIds } from "./reference-features";
import { sanitizeSearchText, searchReferences } from "./references";

type Call = { method: string; args: unknown[] };

function fakeClient(result: { data: unknown; error?: unknown; count?: number }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const chain = new Proxy(builder, {
    get(_target, method: string) {
      if (method === "then") {
        return (resolve: (value: unknown) => void) => resolve({ data: result.data, error: result.error ?? null, count: result.count ?? null });
      }
      return (...args: unknown[]) => {
        calls.push({ method, args });
        return chain;
      };
    },
  });
  const client = { from: (table: string) => (calls.push({ method: "from", args: [table] }), chain) };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

describe("sanitizeSearchText", () => {
  it("keeps words, note names and hyphens; removes PostgREST syntax", () => {
    expect(sanitizeSearchText("  A#4  grand-piano ")).toBe("A#4 grand-piano");
    expect(sanitizeSearchText("x,name.eq.y)*%(\"'")).toBe("x name eq y");
    expect(sanitizeSearchText("ünïcödé")).toBe("ünïcödé");
    expect(sanitizeSearchText("a".repeat(100))).toHaveLength(60);
  });
});

describe("searchReferences", () => {
  it("filters by instrument with an inner join and orders samples by note", async () => {
    const { client, calls } = fakeClient({ data: [], count: 0 });
    await searchReferences(client, { instrumentId: "i1", query: "A4, piano)", page: 2, pageSize: 10 });
    const select = calls.find((c) => c.method === "select")!;
    expect(String(select.args[0])).toContain("instrument_samples!inner(");
    expect(calls).toContainEqual({ method: "eq", args: ["instrument_samples.instrument_id", "i1"] });
    expect(calls).toContainEqual({ method: "order", args: ["storage_path"] });
    expect(calls).toContainEqual({ method: "range", args: [10, 19] });
    const or = calls.find((c) => c.method === "or")!;
    expect(or.args[0]).toBe('name.ilike.*A4 piano*,description.ilike.*A4 piano*,tags.ov.{"a4","piano"}');
  });

  it("maps rows, including a one-to-one sample embed returned as an object", async () => {
    const { client } = fakeClient({
      count: 1,
      data: [
        {
          id: "r1",
          name: "Piano A4",
          description: null,
          tags: ["piano"],
          duration_ms: 2000,
          sample_rate: 44100,
          visibility: "public",
          is_synthetic: false,
          license: "CC0",
          source_url: null,
          attribution: "Someone",
          storage_path: "piano/grand/069_A4.wav",
          created_at: "2026-01-01",
          reference_categories: { id: "c1", slug: "piano", name: "Piano" },
          instrument_samples: { instrument_id: "i1", variant: "grand", midi_note: 69, note_name: "A4", velocity: null, instruments: { slug: "piano", name: "Piano" } },
        },
      ],
    });
    const page = await searchReferences(client, {});
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ id: "r1", category: { slug: "piano" }, sample: { midiNote: 69, instrumentSlug: "piano", velocity: null } });
  });
});

describe("listOutdatedReferenceIds", () => {
  const current = (strategy: string) => ({ strategy_id: strategy, algorithm_version: strategy === "pitch" ? PITCH_STRATEGY_VERSION : TIMBRE_STRATEGY_VERSION });
  const sample = { midi_note: 69, instruments: { slug: "piano" } };

  it("finds references missing a current feature for any strategy that applies", async () => {
    const { client } = fakeClient({
      data: [
        { id: "sound-ok", reference_categories: { slug: "animals" }, instrument_samples: null, reference_features: [current("timbre")] },
        { id: "sound-missing", reference_categories: { slug: "animals" }, instrument_samples: null, reference_features: [] },
        { id: "note-ok", reference_categories: { slug: "piano" }, instrument_samples: sample, reference_features: [current("pitch"), current("timbre")] },
        { id: "note-no-pitch", reference_categories: { slug: "piano" }, instrument_samples: sample, reference_features: [current("timbre")] },
        {
          id: "note-old-version",
          reference_categories: { slug: "piano" },
          instrument_samples: [sample],
          reference_features: [{ strategy_id: "pitch", algorithm_version: "0.9.0" }, current("timbre")],
        },
      ],
    });
    expect(await listOutdatedReferenceIds(client)).toEqual(["sound-missing", "note-no-pitch", "note-old-version"]);
  });
});
