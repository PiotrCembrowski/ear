import { describe, expect, it } from "vitest";
import { pitchStrategy, timbreStrategy, type ComparisonResult } from "@/lib/audio-engine";
import { fakeSupabase, type Call } from "../../../tests/stubs/fake-supabase-client";
import { syntheticPianoNote } from "../../../tests/audio/synthetic";
import { recordComparison, type RecordDeps } from "./record-comparison";

const USER = "11111111-1111-4111-8111-111111111111";
const REF = "20000000-0000-4000-8000-000000000001";
const SOUND_REF = "20000000-0000-4000-8000-000000000002";
const PIANO = "10000000-0000-4000-8000-000000000001";

const pianoReferenceRow = {
  id: REF,
  name: "Piano A4 · grand · v80",
  description: null,
  tags: [],
  duration_ms: 2000,
  sample_rate: 44100,
  visibility: "public",
  is_synthetic: false,
  license: "CC0",
  source_url: null,
  attribution: "x",
  storage_path: "piano/grand/069_A4_v80.wav",
  created_at: "2026-01-01",
  reference_categories: { id: "c", slug: "piano", name: "Piano" },
  instrument_samples: { instrument_id: PIANO, variant: "grand", midi_note: 69, note_name: "A4", velocity: 80, instruments: { slug: "piano", name: "Piano" } },
};

function realPitchResult(): ComparisonResult {
  const clip = (midi: number) => ({ samples: syntheticPianoNote(midi, 1, 44100), sampleRate: 44100 });
  return pitchStrategy.compare(pitchStrategy.extract(clip(69)), pitchStrategy.extract(clip(69)));
}

function setup(options: { allowRate?: boolean; saveHistory?: boolean; reference?: unknown; samples?: unknown[] } = {}) {
  const user = fakeSupabase(
    {
      reference_sounds: () => ({ data: options.reference === undefined ? pianoReferenceRow : options.reference }),
      instruments: () => ({ data: [{ id: PIANO, slug: "piano", name: "Piano", category_id: "c", midi_min: 21, midi_max: 108, expected_note_count: 88 }] }),
      instrument_samples: () => ({ data: options.samples ?? [] }),
    },
    () => ({ data: options.allowRate ?? true }),
  );
  const inserted: Call[] = [];
  const admin = fakeSupabase({
    comparisons: (calls) => {
      inserted.push(...calls.filter((c) => c.method === "insert"));
      return { data: { id: "new-id" } };
    },
  });
  const deps: RecordDeps = {
    userClient: user.client,
    adminClient: admin.client,
    userId: USER,
    saveHistory: options.saveHistory ?? true,
    rateLimit: { max: 120, windowSeconds: 600 },
  };
  return { deps, userCalls: user.calls, inserted };
}

const insertedRow = (inserted: Call[]) => inserted[0]!.args[0] as Record<string, unknown>;

describe("recordComparison", () => {
  it("saves a compare result with the session's user id, a server-built title and a reference snapshot", async () => {
    const { deps, inserted, userCalls } = setup();
    const outcome = await recordComparison(deps, { mode: "compare", trigger: "auto", referenceId: REF, result: realPitchResult() });
    expect(outcome).toEqual({ status: "saved", id: "new-id" });
    const row = insertedRow(inserted);
    expect(row).toMatchObject({ user_id: USER, mode: "compare", reference_sound_id: REF, instrument_id: PIANO, strategy_id: "pitch", computed_on: "client", score: 100 });
    expect(row.title).toBe("A4 vs Piano A4 · grand · v80");
    expect((row.result as { reference: { name: string } }).reference.name).toBe("Piano A4 · grand · v80");
    expect(userCalls.some((c) => c.table === "rpc" && c.method === "consume_rate_limit")).toBe(true);
  });

  it("ignores any user id or extra fields sent by the client", async () => {
    const { deps } = setup();
    const outcome = await recordComparison(deps, { mode: "compare", trigger: "auto", referenceId: REF, result: realPitchResult(), userId: "someone-else" });
    expect(outcome).toMatchObject({ status: "rejected", reason: "invalid" });
  });

  it("rejects impossible scores, unknown warning codes and oversized arrays", async () => {
    const { deps, inserted } = setup();
    const good = realPitchResult();
    for (const result of [
      { ...good, score: 101 },
      { ...good, score: Number.NaN },
      { ...good, warnings: [{ code: "made_up", message: "x" }] },
      { ...good, visuals: { pitchTrack: { timeMs: new Array(500).fill(0), cents: new Array(500).fill(0) } } },
      { ...good, explanation: "x".repeat(5000) },
    ]) {
      expect(await recordComparison(deps, { mode: "compare", trigger: "auto", referenceId: REF, result })).toMatchObject({ reason: "invalid" });
    }
    expect(inserted).toHaveLength(0);
  });

  it("rejects old algorithm versions and strategies that don't fit the reference", async () => {
    const { deps } = setup();
    const result = realPitchResult();
    expect(await recordComparison(deps, { mode: "compare", trigger: "auto", referenceId: REF, result: { ...result, algorithmVersion: "0.1.0" } })).toMatchObject({
      reason: "outdated",
    });
    const timbre = timbreStrategy.compare(
      timbreStrategy.extract({ samples: syntheticPianoNote(69, 1, 44100), sampleRate: 44100 }),
      timbreStrategy.extract({ samples: syntheticPianoNote(69, 1, 44100), sampleRate: 44100 }),
    );
    expect(await recordComparison(deps, { mode: "compare", trigger: "auto", referenceId: REF, result: timbre })).toMatchObject({ reason: "invalid" });
  });

  it("refuses references the user can't see", async () => {
    const { deps } = setup({ reference: null });
    expect(await recordComparison(deps, { mode: "compare", trigger: "auto", referenceId: SOUND_REF, result: realPitchResult() })).toMatchObject({
      reason: "not-found",
    });
  });

  it("skips automatic saves when history saving is off, but allows explicit saves", async () => {
    const off = setup({ saveHistory: false });
    expect(await recordComparison(off.deps, { mode: "compare", trigger: "auto", referenceId: REF, result: realPitchResult() })).toEqual({
      status: "skipped",
      reason: "history-off",
    });
    expect(await recordComparison(off.deps, { mode: "compare", trigger: "manual", referenceId: REF, result: realPitchResult() })).toMatchObject({ status: "saved" });
  });

  it("applies the rate limit", async () => {
    const { deps, inserted } = setup({ allowRate: false });
    expect(await recordComparison(deps, { mode: "compare", trigger: "auto", referenceId: REF, result: realPitchResult() })).toMatchObject({ reason: "rate-limited" });
    expect(inserted).toHaveLength(0);
  });

  it("saves identified notes without a score", async () => {
    const { deps, inserted } = setup();
    const outcome = await recordComparison(deps, {
      mode: "identify",
      trigger: "manual",
      result: { name: "A#4", midi: 70, hz: 467.9, cents: -6.4, confidence: { value: 0.9, level: "high" }, warnings: [], durationMs: 1200 },
    });
    expect(outcome.status).toBe("saved");
    expect(insertedRow(inserted)).toMatchObject({ mode: "identify", score: null, strategy_id: "pitch", title: "Note A#4, −6 cents" });
  });

  it("saves closest-match rankings only for samples of that instrument", async () => {
    const match = { id: REF, score: 98.5, cents: 3.1, timbreScore: 88 };
    const closest = { strategyId: "pitch", algorithmVersion: pitchStrategy.version, matches: [match], compared: 40, warnings: [], characteristics: [] };
    const sample = { reference_sound_id: REF, note_name: "A4", midi_note: 69, velocity: 80, variant: "grand", reference_sounds: { name: "Piano A4 · grand · v80", is_synthetic: false } };

    const ok = setup({ samples: [sample] });
    expect(await recordComparison(ok.deps, { mode: "closest", trigger: "auto", instrumentId: PIANO, variant: "grand", result: closest })).toMatchObject({ status: "saved" });
    expect(insertedRow(ok.inserted)).toMatchObject({ mode: "closest", reference_sound_id: REF, score: 98.5, title: "Closest piano note: Piano A4 · grand · v80" });

    const foreign = setup({ samples: [] });
    expect(await recordComparison(foreign.deps, { mode: "closest", trigger: "auto", instrumentId: PIANO, variant: null, result: closest })).toMatchObject({
      reason: "invalid",
    });
  });
});

describe("stored results", () => {
  it("are readable by the history view's schema", async () => {
    const { storedResultSchema } = await import("@/lib/validation/comparisons");
    const { deps, inserted } = setup();
    await recordComparison(deps, { mode: "compare", trigger: "auto", referenceId: REF, result: realPitchResult() });
    const stored = insertedRow(inserted).result;
    expect(storedResultSchema.safeParse(stored).success).toBe(true);
  });
});
