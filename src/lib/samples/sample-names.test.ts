import { describe, expect, it } from "vitest";
import {
  formatNoteRanges,
  isAudioFileName,
  noteCoverage,
  parseSampleFileName,
  sampleDisplayName,
  sampleStoragePath,
} from "./sample-names";

describe("parseSampleFileName", () => {
  it.each([
    ["069_A4_v80.wav", 69, 80],
    ["A#4.wav", 70, null],
    ["As4.wav", 70, null],
    ["Bb4.wav", 70, null],
    ["A-sharp-4.wav", 70, null],
    ["piano-B-flat-4-vel100.wav", 70, 100],
    ["Piano.ff.Bb3.aiff", 58, 112],
    ["Piano.pp.C4.aiff", 60, 33],
    ["C4v8.flac", 60, 8],
    ["D#4v10.wav", 63, 10],
    ["60.wav", 60, null],
    ["021.wav", 21, null],
    ["Grand Piano - A0 - velocity 64.wav", 21, 64],
    ["Grand Piano A0 velocity64.wav", 21, 64],
    ["folder/sub/108_C8_v127.wav", 108, 127],
    ["c-1.wav", 0, null],
  ])("%s → MIDI %i, velocity %s", (name, midi, velocity) => {
    const parsed = parseSampleFileName(name);
    expect(parsed).toMatchObject({ ok: true, midi, velocity });
  });

  it.each([["kick.wav"], ["recording 2024.wav"], ["H4.wav"]])("finds no note in %s", (name) => {
    expect(parseSampleFileName(name)).toEqual({ ok: false, reason: "no-note" });
  });

  it("rejects names with two different notes", () => {
    expect(parseSampleFileName("C4 to E4.wav")).toEqual({ ok: false, reason: "ambiguous-note" });
  });

  it("accepts the same note written twice", () => {
    expect(parseSampleFileName("069_A4.wav")).toMatchObject({ ok: true, midi: 69 });
  });
});

describe("storage paths and names", () => {
  it("never contains '#', and sorts by MIDI number", () => {
    expect(sampleStoragePath("piano", "grand-default", 69, 80)).toBe("piano/grand-default/069_A4_v80.wav");
    expect(sampleStoragePath("piano", "grand-default", 70, null)).toBe("piano/grand-default/070_As4.wav");
    expect(sampleStoragePath("piano", "x", 0, null)).toBe("piano/x/000_Cm1.wav");
    expect(sampleStoragePath("piano", "x", 70, 1)).not.toContain("#");
  });

  it("builds display names", () => {
    expect(sampleDisplayName("Piano", 70, "grand-default", 80)).toBe("Piano A#4 · grand-default · v80");
    expect(sampleDisplayName("Piano", 60, "upright", null)).toBe("Piano C4 · upright");
  });

  it("recognises audio extensions", () => {
    expect(isAudioFileName("a.WAV")).toBe(true);
    expect(isAudioFileName("a.aiff")).toBe(true);
    expect(isAudioFileName("readme.txt")).toBe(false);
    expect(isAudioFileName("noext")).toBe(false);
  });
});

describe("coverage", () => {
  const piano = { midiMin: 21, midiMax: 108, expectedNoteCount: 88 };

  it("reports a full piano as complete", () => {
    const all = Array.from({ length: 88 }, (_, i) => 21 + i);
    expect(noteCoverage(piano, all)).toMatchObject({ present: 88, missing: [], complete: true });
  });

  it("reports partial sets with the missing notes (e.g. every third key)", () => {
    const everyThird = Array.from({ length: 30 }, (_, i) => 21 + i * 3);
    const coverage = noteCoverage(piano, [...everyThird, 200]);
    expect(coverage.present).toBe(30);
    expect(coverage.complete).toBe(false);
    expect(coverage.missing).toHaveLength(58);
    expect(coverage.missing[0]).toBe(22);
  });

  it("formats missing notes as ranges", () => {
    expect(formatNoteRanges([21, 22, 23, 25, 27, 28])).toBe("A0–B0, C#1, D#1–E1");
    expect(formatNoteRanges([])).toBe("");
  });
});
