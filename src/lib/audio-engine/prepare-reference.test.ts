import { describe, expect, it } from "vitest";
import { concat, silence, sine } from "../../../tests/audio/synthetic";
import { prepareReferenceAudio } from "./prepare-reference";

const SR = 44100;

describe("prepareReferenceAudio", () => {
  it("downmixes to mono, trims padding with a 20 ms margin, and keeps the level", () => {
    const left = concat(silence(0.5, SR), sine(440, 1, SR, 0.4), silence(0.7, SR));
    const right = concat(silence(0.5, SR), sine(440, 1, SR, 0.2), silence(0.7, SR));
    const result = prepareReferenceAudio([left, right], SR);
    expect(result.trimmedStartMs).toBeCloseTo(480, 0);
    expect(result.durationMs).toBeGreaterThan(1030);
    expect(result.durationMs).toBeLessThan(1045);
    expect(result.peakDb).toBeCloseTo(20 * Math.log10(0.3), 1);
    expect(result.truncated).toBe(false);
  });

  it("caps long sounds at 30 s", () => {
    const result = prepareReferenceAudio([sine(220, 31, 8000, 0.3)], 8000);
    expect(result.truncated).toBe(true);
    expect(result.durationMs).toBe(30_000);
  });

  it("returns an empty clip for pure silence", () => {
    const result = prepareReferenceAudio([silence(1, SR)], SR);
    expect(result.clip.samples.length).toBe(0);
  });
});
