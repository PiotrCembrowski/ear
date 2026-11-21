/**
 * Strategy tests, including the required ones from the project spec
 * (synthetic signals are allowed in tests):
 *   - a 440 Hz sine is detected as A4 within ±1 cent, and 261.63 Hz as C4
 *   - an octave-shifted tone is flagged as an octave error
 *   - white noise gives low pitch confidence
 *   - an identical clip scores about 100
 *   - a time-shifted copy still scores high under DTW
 *   - feeding a signal in 128-sample blocks gives the same features as batch extraction
 * (onset detection is covered in event-detector.test.ts)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  concat,
  harmonicTone,
  mix,
  silence,
  sine,
  syntheticFluteNote,
  syntheticHit,
  syntheticPianoNote,
  syntheticPluck,
  whiteNoise,
} from "../../../tests/audio/synthetic";
import { dtw } from "./dtw";
import { extractReferenceFeatures } from "./reference-features";
import { defaultRegistry, StrategyRegistry } from "./registry";
import { centsToScore, identifyNote, pitchConfidence, pitchStrategy, type PitchFeatures } from "./strategies/pitch";
import { timbreStrategy, type TimbreFeatures } from "./strategies/timbre";
import type { AudioClip, ComparisonStrategy, FeatureSet } from "./types";

const SR = 44100;
const clip = (samples: Float32Array, sampleRate = SR): AudioClip => ({ samples, sampleRate });

function pushInBlocks<T>(strategy: ComparisonStrategy<T>, input: AudioClip, blockSize: number): FeatureSet<T> {
  const analyzer = strategy.createAnalyzer(input.sampleRate);
  for (let offset = 0; offset < input.samples.length; offset += blockSize) {
    analyzer.push(input.samples.subarray(offset, offset + blockSize));
  }
  return analyzer.finish();
}

describe("pitch strategy", () => {
  it("detects a 440 Hz sine as A4 within ±1 cent", () => {
    const reading = identifyNote(pitchStrategy.extract(clip(sine(440, 1, SR))) as PitchFeatures);
    expect(reading?.name).toBe("A4");
    expect(Math.abs(reading!.cents)).toBeLessThanOrEqual(1);
    expect(reading?.confidence.level).toBe("high");
  });

  it("detects a 261.63 Hz sine as C4 within ±1 cent", () => {
    const reading = identifyNote(pitchStrategy.extract(clip(sine(261.63, 1, SR))) as PitchFeatures);
    expect(reading?.name).toBe("C4");
    expect(Math.abs(reading!.cents)).toBeLessThanOrEqual(1);
  });

  it("names notes relative to the user's A4 setting", () => {
    const reading = identifyNote(pitchStrategy.extract(clip(sine(442, 1, SR))) as PitchFeatures, 442);
    expect(reading?.name).toBe("A4");
    expect(Math.abs(reading!.cents)).toBeLessThan(0.5);
  });

  it("is accurate across the piano range, from A0 to C8 (within 1 cent on sines)", () => {
    for (const hz of [27.5, 55, 110, 880, 2093, 4186.01]) {
      const reading = identifyNote(pitchStrategy.extract(clip(sine(hz, 1, SR))) as PitchFeatures);
      expect(Math.abs(1200 * Math.log2(reading!.hz / hz)), `${hz} Hz`).toBeLessThan(1);
    }
  });

  it("flags an octave-shifted tone as an octave error (and scores it 0)", () => {
    const reference = pitchStrategy.extract(clip(syntheticPianoNote(57, 1.2, SR)));
    const input = pitchStrategy.extract(clip(syntheticPianoNote(69, 1.2, SR, 0.5, 4)));
    const result = pitchStrategy.compare(input, reference);
    expect(result.warnings.map((w) => w.code)).toContain("octave_error");
    expect(result.score).toBe(0);
    expect(result.explanation).toMatch(/1 octave above/);
  });

  it("gives white noise low pitch confidence and a 'no clear pitch' warning", () => {
    const features = pitchStrategy.extract(clip(whiteNoise(1, SR, 0.3, 5))) as PitchFeatures;
    expect(pitchConfidence(features.data).level).toBe("low");
    expect(identifyNote(features)).toBeNull();
    const result = pitchStrategy.compare(features, pitchStrategy.extract(clip(sine(440, 1, SR))));
    expect(result.score).toBe(0);
    expect(result.warnings.map((w) => w.code)).toContain("no_clear_pitch");
  });

  it("scores an identical clip 100", () => {
    const features = pitchStrategy.extract(clip(syntheticPianoNote(60, 1.2, SR)));
    expect(pitchStrategy.compare(features, features).score).toBe(100);
  });

  it("maps cents to score with the documented curve", () => {
    expect(centsToScore(0)).toBe(100);
    expect(centsToScore(5)).toBeCloseTo(97.6, 1);
    expect(centsToScore(-10)).toBeCloseTo(90.5, 1);
    expect(centsToScore(25)).toBeCloseTo(50, 6);
    expect(centsToScore(50)).toBeCloseTo(0, 6);
    expect(centsToScore(120)).toBeCloseTo(0, 6);
  });

  it("compares against the reference's measured pitch and reports cents", () => {
    const reference = pitchStrategy.extract(clip(sine(440, 1, SR)));
    const input = pitchStrategy.extract(clip(sine(440 * 2 ** (7 / 1200), 1, SR)));
    const result = pitchStrategy.compare(input, reference);
    expect(result.score).toBeCloseTo(centsToScore(7), 0);
    expect(result.breakdown[0]?.detail).toBe("+7 cents from the reference");
    expect(result.visuals.pitchTrack?.cents.every((c) => Math.abs(c - 7) < 1)).toBe(true);
  });

  it("warns about multiple notes in one sound", () => {
    const twoNotes = concat(syntheticFluteNote(60, 0.8, SR), syntheticFluteNote(64, 0.8, SR, 9));
    const features = pitchStrategy.extract(clip(twoNotes)) as PitchFeatures;
    expect(features.data.noteCount).toBe(2);
    expect(identifyNote(features)?.warnings.map((w) => w.code)).toContain("multiple_notes");
  });

  it("warns about clipping and very quiet input", () => {
    const loud = pitchStrategy.extract(clip(sine(440, 1, SR, 1.4).map((v) => Math.max(-1, Math.min(1, v))))) as PitchFeatures;
    expect(identifyNote(loud)?.warnings.map((w) => w.code)).toContain("clipping");
    const quiet = pitchStrategy.extract(clip(sine(440, 1, SR, 0.003))) as PitchFeatures;
    expect(identifyNote(quiet)?.warnings.map((w) => w.code)).toContain("too_quiet");
  });

  it("gives the same pitch from 44.1 kHz and 48 kHz input", () => {
    const a = identifyNote(pitchStrategy.extract(clip(syntheticPianoNote(64, 1, 44100), 44100)) as PitchFeatures)!;
    const b = identifyNote(pitchStrategy.extract(clip(syntheticPianoNote(64, 1, 48000), 48000)) as PitchFeatures)!;
    expect(Math.abs(1200 * Math.log2(a.hz / b.hz))).toBeLessThan(0.2);
  });
});

describe("timbre strategy", () => {
  const piano = clip(syntheticPianoNote(60, 1.2, SR));

  it("scores an identical clip 100", () => {
    const features = timbreStrategy.extract(piano);
    expect(timbreStrategy.compare(features, features).score).toBe(100);
  });

  it("still scores a time-shifted copy high (DTW alignment)", () => {
    // The same sound in the same quiet room, once starting 120 ms later.
    const room = (lead: number) => clip(mix(concat(silence(lead, SR), piano.samples, silence(0.3, SR)), whiteNoise(lead + 1.5, SR, 0.001, 3)));
    const result = timbreStrategy.compare(timbreStrategy.extract(room(0.12)), timbreStrategy.extract(room(0)));
    expect(result.score).toBeGreaterThan(90);
  });

  it("still scores a slightly slower copy high (DTW absorbs tempo differences)", () => {
    const sweep = (seconds: number) => {
      // A tone whose harmonic content changes over time, played at two speeds.
      const n = Math.round(seconds * SR);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        out[i] = 0.4 * Math.sin((2 * Math.PI * 300 * i) / SR) + 0.3 * t * Math.sin((2 * Math.PI * 1500 * i) / SR) + 0.2 * (1 - t) * Math.sin((2 * Math.PI * 4000 * i) / SR);
      }
      return clip(out);
    };
    const result = timbreStrategy.compare(timbreStrategy.extract(sweep(1.15)), timbreStrategy.extract(sweep(1.0)));
    expect(result.score).toBeGreaterThan(85);
  });

  it("scores clearly different sounds low", () => {
    const pianoFeatures = timbreStrategy.extract(piano);
    for (const other of [syntheticHit(0.4, SR), whiteNoise(0.8, SR, 0.3, 2), syntheticFluteNote(72, 1, SR)]) {
      expect(timbreStrategy.compare(timbreStrategy.extract(clip(other)), pianoFeatures).score).toBeLessThan(40);
    }
  });

  it("orders similarity sensibly: same sound > same instrument, other note > different instrument", () => {
    const reference = timbreStrategy.extract(piano);
    const replayed = timbreStrategy.compare(timbreStrategy.extract(clip(syntheticPianoNote(60, 1.2, SR, 0.4, 99))), reference).score;
    const otherNote = timbreStrategy.compare(timbreStrategy.extract(clip(syntheticPianoNote(67, 1.2, SR))), reference).score;
    const pluck = timbreStrategy.compare(timbreStrategy.extract(clip(syntheticPluck(36, 1.2, SR))), reference).score;
    expect(replayed).toBeGreaterThan(otherNote);
    expect(otherNote).toBeGreaterThan(pluck);
  });

  it("ignores overall volume", () => {
    const reference = timbreStrategy.extract(piano);
    const quieter = timbreStrategy.extract(clip(piano.samples.map((v) => v * 0.25)));
    expect(timbreStrategy.compare(quieter, reference).score).toBeGreaterThan(97);
  });

  it("gives nearly the same result from 44.1 kHz and 48 kHz input", () => {
    const a = timbreStrategy.extract(clip(syntheticPianoNote(60, 1, 44100), 44100));
    const b = timbreStrategy.extract(clip(syntheticPianoNote(60, 1, 48000), 48000));
    expect(timbreStrategy.compare(a, b).score).toBeGreaterThan(97);
  });
});

describe("streaming equals batch", () => {
  const signals: Array<[string, AudioClip]> = [
    ["piano note at 44.1 kHz", clip(syntheticPianoNote(57, 1.3, 44100), 44100)],
    ["noisy flute at 48 kHz", clip(mix(syntheticFluteNote(76, 1, 48000), whiteNoise(1, 48000, 0.01, 4)), 48000)],
    ["very short hit at 48 kHz", clip(syntheticHit(0.06, 48000), 48000)],
  ];
  for (const strategy of [pitchStrategy, timbreStrategy] as ComparisonStrategy<unknown>[]) {
    for (const [name, input] of signals) {
      it(`${strategy.id}: 128-sample blocks give exactly the batch features (${name})`, () => {
        const batch = strategy.extract(input);
        expect(pushInBlocks(strategy, input, 128)).toEqual(batch);
        expect(pushInBlocks(strategy, input, 1000)).toEqual(batch);
      });
    }
  }

  it("an analyzer can be reset and reused", () => {
    const analyzer = pitchStrategy.createAnalyzer(SR);
    analyzer.push(sine(300, 0.5, SR));
    analyzer.finish();
    analyzer.reset();
    analyzer.push(sine(440, 1, SR));
    expect(analyzer.finish()).toEqual(pitchStrategy.extract(clip(sine(440, 1, SR))));
  });
});

describe("live snapshot", () => {
  it("reports the current pitch and level while a note plays", () => {
    const analyzer = pitchStrategy.createAnalyzer(SR);
    analyzer.push(sine(440, 0.3, SR, 0.5));
    const reading = analyzer.snapshot();
    expect(reading.pitch?.hz).toBeCloseTo(440, 0);
    expect(reading.levelDb).toBeGreaterThan(-10);
    expect(reading.elapsedMs).toBeCloseTo(300, 0);
  });
});

describe("DTW", () => {
  it("finds zero cost for a sequence aligned with a time-shifted copy", () => {
    const a = [0, 0, 1, 2, 3, 2, 1, 0, 0, 0];
    const b = [0, 1, 2, 3, 2, 1, 0, 0, 0, 0];
    expect(dtw(a.length, b.length, (i, j) => Math.abs(a[i]! - b[j]!)).meanCost).toBe(0);
  });

  it("aligns a stretched sequence along its warped path", () => {
    const a = [0, 1, 2, 3, 4];
    const b = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
    const result = dtw(a.length, b.length, (i, j) => Math.abs(a[i]! - b[j]!), { freeEnds: 1 });
    expect(result.meanCost).toBe(0);
    expect(result.path[0]).toEqual([0, 0]);
    expect(result.path.at(-1)).toEqual([4, 9]);
  });

  it("reports real differences", () => {
    const result = dtw(4, 4, (i, j) => (i === j ? 1 : 5));
    expect(result.meanCost).toBe(1);
  });
});

describe("registry", () => {
  it("picks pitch for instrument notes and timbre for everything else", () => {
    expect(defaultRegistry.pickFor({ categorySlug: "piano", instrumentSlug: "piano", midiNote: 69 }).id).toBe("pitch");
    expect(defaultRegistry.pickFor({ categorySlug: "animals" }).id).toBe("timbre");
    expect(defaultRegistry.pickFor({ categorySlug: "piano", midiNote: null }).id).toBe("timbre");
  });

  it("knows current strategy versions and rejects duplicates", () => {
    expect(defaultRegistry.isCurrent("pitch", pitchStrategy.version)).toBe(true);
    expect(defaultRegistry.isCurrent("pitch", "0.0.1")).toBe(false);
    expect(defaultRegistry.isCurrent("unknown", "1.0.0")).toBe(false);
    expect(() => new StrategyRegistry([pitchStrategy, pitchStrategy])).toThrow(/already registered/);
  });

  it("accepts new strategies without changing existing code", () => {
    const registry = new StrategyRegistry([pitchStrategy, timbreStrategy]);
    registry.register({ ...timbreStrategy, id: "rhythm", appliesTo: (ref) => ref.categorySlug === "drums" });
    // Order matters: timbre (registered earlier) applies to everything, so put specific ones first in practice.
    expect(registry.get("rhythm")?.id).toBe("rhythm");
  });
});

describe("stored features", () => {
  it("survive a JSON round trip and validate", () => {
    for (const strategy of [pitchStrategy, timbreStrategy] as ComparisonStrategy<unknown>[]) {
      const features = strategy.extract(clip(syntheticPianoNote(60, 1, SR)));
      expect(strategy.parseFeatures(JSON.parse(JSON.stringify(features)))).toEqual(features);
    }
  });

  it("reject malformed or mismatched data", () => {
    const timbre = timbreStrategy.extract(clip(syntheticPianoNote(60, 1, SR)));
    expect(() => pitchStrategy.parseFeatures(timbre)).toThrow();
    expect(() => timbreStrategy.parseFeatures({ strategyId: "timbre", algorithmVersion: "1.0.0", data: { mfcc: "x" } })).toThrow();
  });

  it("stay small, and results fit the 16 KB history limit even for a 5 s sound", () => {
    const long = clip(harmonicTone(220, 5, SR, { harmonics: [1, 0.5, 0.3], wobbleCents: 6 }));
    for (const strategy of [pitchStrategy, timbreStrategy] as ComparisonStrategy<unknown>[]) {
      const features = strategy.extract(long);
      expect(JSON.stringify(features).length, `${strategy.id} features`).toBeLessThan(40_000);
      const result = strategy.compare(features, features);
      expect(JSON.stringify(result).length, `${strategy.id} result`).toBeLessThan(12_000);
    }
  });
});

describe("reference extraction", () => {
  it("analyses only the main sound event of a reference file", () => {
    const file = clip(mix(concat(silence(0.8, SR), syntheticPianoNote(69, 1.5, SR), silence(1, SR)), whiteNoise(3.3, SR, 0.002, 7)));
    const { event, features } = extractReferenceFeatures(file, [pitchStrategy, timbreStrategy] as ComparisonStrategy<unknown>[]);
    expect(event.method).toBe("detected");
    expect(Math.abs(event.startMs - 800)).toBeLessThan(25);
    expect(features.map((f) => f.strategyId)).toEqual(["pitch", "timbre"]);
    expect(identifyNote(features[0] as PitchFeatures)?.name).toBe("A4");
    expect((features[1] as TimbreFeatures).data.stats.durationMs).toBeLessThan(2000);
  });

  it("keeps the attack of a file whose sound starts at the very first sample", () => {
    const { event } = extractReferenceFeatures(clip(sine(440, 2, SR)), [pitchStrategy] as ComparisonStrategy<unknown>[]);
    expect(event.method).toBe("detected");
    expect(event.startMs).toBe(0);
    expect(Math.abs(event.durationMs - 2000)).toBeLessThan(15);
  });

  it("refuses a file with no sound in it", () => {
    expect(() => extractReferenceFeatures(clip(silence(1, SR)), [pitchStrategy] as ComparisonStrategy<unknown>[])).toThrow(/no sound/);
  });
});

describe("engine purity", () => {
  it("imports nothing from React, Next.js, Supabase, app code or browser-only APIs", () => {
    const dir = path.resolve(__dirname);
    const files = readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of files) {
      // Strip comments: prose may mention these names.
      const source = readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/from\s+["'](react|next|@supabase|@\/)/);
      expect(source, file).not.toMatch(/\b(window|document|AudioContext|navigator)\./);
    }
  });
});
