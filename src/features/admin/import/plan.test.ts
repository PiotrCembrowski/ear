import { describe, expect, it } from "vitest";
import { countByStatus, planImport, plannedCoverage } from "./plan";

const piano = { name: "Piano", midiMin: 21, midiMax: 108, expectedNoteCount: 88 };
const file = (name: string, size = 1000) => ({ name, size });

describe("planImport", () => {
  it("classifies each file: ok, duplicate, invalid name, unsupported format", () => {
    const rows = planImport(
      [
        file("069_A4_v80.wav"),
        file("A4_v80.flac"), // same note + velocity as above
        file("070_As4_v80.wav"), // already in the library
        file("C9.wav"), // outside the piano
        file("kick.wav"), // no note
        file("notes.txt"),
        file("huge_C4.wav", 60 * 1024 * 1024),
        file("Bb3.mp3"),
      ],
      piano,
      new Set(["70:80"]),
    );
    expect(rows.map((r) => r.status)).toEqual([
      "checking",
      "duplicate",
      "duplicate",
      "invalid-name",
      "invalid-name",
      "unsupported-format",
      "unsupported-format",
      "checking",
    ]);
    expect(rows[0]).toMatchObject({ midi: 69, noteName: "A4", velocity: 80 });
    expect(rows[3]!.detail).toMatch(/outside the piano's range/);
    expect(rows[2]!.detail).toMatch(/already in the library/);
    expect(rows[7]).toMatchObject({ midi: 58, velocity: null });
  });

  it("treats the same note at different velocities as separate samples", () => {
    const rows = planImport([file("A4_v40.wav"), file("A4_v80.wav")], piano, new Set());
    expect(rows.every((r) => r.status === "checking")).toBe(true);
  });

  it("reports coverage including notes already stored, and counts statuses", () => {
    const rows = planImport([file("A4.wav"), file("B4.wav"), file("bad.wav")], piano, new Set());
    const coverage = plannedCoverage(rows, piano, [21, 69]);
    expect(coverage.present).toBe(3); // A0, A4, B4 (A4 counted once)
    expect(coverage.complete).toBe(false);
    expect(countByStatus(rows)).toEqual({ checking: 2, "invalid-name": 1 });
  });
});
