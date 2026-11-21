/**
 * Engine calibration report.
 *
 * Runs the engine over labelled pairs of sounds and prints the score
 * distribution per label, so we can see whether the scores make sense
 * (same sound ≫ related sounds ≫ unrelated sounds).
 *
 *   npx tsx scripts/evaluate-engine.ts            # synthetic fixtures only
 *   npx tsx scripts/evaluate-engine.ts --verbose  # every pair with its breakdown
 *
 * Synthetic fixtures are generated in code (tests/audio/synthetic.ts) and are
 * for calibration only. Real recordings give a much better picture: put WAV
 * files in fixtures/real/ with a manifest.json like
 *   { "pairs": [ { "input": "my-a4.wav", "reference": "piano-a4.wav", "label": "same note", "strategy": "pitch" } ] }
 * and they are evaluated too (fixtures/real is git-ignored because of licenses).
 *
 * Both sides go through the same path as the app: sound-event detection,
 * then feature extraction, then comparison.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { decodeWav } from "../src/lib/audio-engine/wav";
import { extractReferenceFeatures } from "../src/lib/audio-engine/reference-features";
import { defaultRegistry } from "../src/lib/audio-engine/registry";
import { median } from "../src/lib/audio-engine/math";
import type { AudioClip, ComparisonResult } from "../src/lib/audio-engine/types";
import {
  concat,
  gain,
  mix,
  silence,
  syntheticFluteNote,
  syntheticHit,
  syntheticPianoNote,
  syntheticPluck,
  whiteNoise,
  harmonicTone,
} from "../tests/audio/synthetic";
import { midiToHz } from "../src/lib/audio-engine/notes";

const SR = 44100;
const verbose = process.argv.includes("--verbose");

type Pair = { label: string; strategy: "pitch" | "timbre"; input: AudioClip; reference: AudioClip; expect: "high" | "mid" | "low" };

const clip = (samples: Float32Array, sampleRate = SR): AudioClip => ({ samples, sampleRate });
/** Puts a sound in a realistic recording: short lead-in, room hiss, tail. */
const recorded = (sound: Float32Array, seed: number, leadSeconds = 0.3, hissAmplitude = 0.002) =>
  clip(mix(concat(silence(leadSeconds, SR), sound, silence(0.5, SR)), whiteNoise(leadSeconds + sound.length / SR + 0.5, SR, hissAmplitude, seed)));

function detuned(midi: number, cents: number, seconds: number, seed: number) {
  return harmonicTone(midiToHz(midi) * 2 ** (cents / 1200), seconds, SR, {
    harmonics: [1, 0.7, 0.45, 0.3, 0.2, 0.14, 0.1, 0.07, 0.05, 0.03],
    decaySeconds: 1.2,
    inharmonicity: 0.0004,
    amplitude: 0.5,
    seed,
  });
}

function syntheticPairs(): Pair[] {
  const pairs: Pair[] = [];
  // --- pitch strategy (instrument notes) ---
  for (const midi of [33, 45, 57, 69, 81, 93]) {
    const ref = recorded(syntheticPianoNote(midi, 1.5, SR, 0.6, 11), 1);
    pairs.push({ label: "pitch: same note, re-played", strategy: "pitch", input: recorded(syntheticPianoNote(midi, 1.2, SR, 0.4, 21), 2), reference: ref, expect: "high" });
    pairs.push({ label: "pitch: +7 cents", strategy: "pitch", input: recorded(detuned(midi, 7, 1.2, 4), 3), reference: ref, expect: "high" });
    pairs.push({ label: "pitch: +20 cents", strategy: "pitch", input: recorded(detuned(midi, 20, 1.2, 4), 3), reference: ref, expect: "mid" });
    pairs.push({ label: "pitch: a semitone apart", strategy: "pitch", input: recorded(syntheticPianoNote(midi + 1, 1.2, SR, 0.5, 31), 4), reference: ref, expect: "low" });
    pairs.push({ label: "pitch: an octave apart", strategy: "pitch", input: recorded(syntheticPianoNote(midi + 12, 1.2, SR, 0.5, 41), 5), reference: ref, expect: "low" });
    pairs.push({ label: "pitch: other instrument, same note", strategy: "pitch", input: recorded(syntheticFluteNote(midi, 1.2, SR), 6), reference: ref, expect: "high" });
    pairs.push({ label: "pitch: noise vs note", strategy: "pitch", input: recorded(whiteNoise(0.8, SR, 0.3, midi), 7), reference: ref, expect: "low" });
  }
  // --- timbre strategy (general sounds) ---
  const sounds = {
    piano: (seed: number) => syntheticPianoNote(60, 1.2, SR, 0.6, seed),
    flute: (seed: number) => syntheticFluteNote(60, 1.2, SR, seed),
    pluck: (seed: number) => syntheticPluck(48, 1.2, SR, seed),
    hit: (seed: number) => syntheticHit(0.4, SR, seed),
  };
  for (const [name, make] of Object.entries(sounds)) {
    const ref = recorded(make(1), 1);
    pairs.push({ label: "timbre: identical clip", strategy: "timbre", input: ref, reference: ref, expect: "high" });
    pairs.push({ label: "timbre: same sound, re-played + noise", strategy: "timbre", input: recorded(gain(make(2), 0.7), 9, 0.45, 0.004), reference: ref, expect: "high" });
    pairs.push({
      label: "timbre: same sound, delayed 120 ms",
      strategy: "timbre",
      input: recorded(make(1), 1, 0.42),
      reference: ref,
      expect: "high",
    });
    for (const [other, makeOther] of Object.entries(sounds)) {
      if (other !== name) pairs.push({ label: "timbre: different kind of sound", strategy: "timbre", input: recorded(makeOther(3), 10), reference: ref, expect: "low" });
    }
    // A burst of white noise legitimately sounds like the synthetic hit (which IS
    // decaying white noise), so that pair is labelled separately.
    pairs.push({
      label: name === "hit" ? "timbre: steady noise vs noise burst" : "timbre: noise vs tonal sound",
      strategy: "timbre",
      input: recorded(whiteNoise(0.8, SR, 0.3, 12), 11),
      reference: ref,
      expect: name === "hit" ? "mid" : "low",
    });
  }
  pairs.push({
    label: "timbre: same instrument, other note",
    strategy: "timbre",
    input: recorded(syntheticPianoNote(67, 1.2, SR, 0.6, 5), 12),
    reference: recorded(syntheticPianoNote(60, 1.2, SR, 0.6, 1), 1),
    expect: "mid",
  });
  return pairs;
}

function realPairs(): Pair[] {
  const dir = path.resolve("fixtures/real");
  const manifestPath = path.join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    pairs: Array<{ input: string; reference: string; label: string; strategy: "pitch" | "timbre"; expect?: Pair["expect"] }>;
  };
  const load = (file: string) => decodeWav(readFileSync(path.join(dir, file)));
  return manifest.pairs.map((p) => ({ label: `real: ${p.label}`, strategy: p.strategy, input: load(p.input), reference: load(p.reference), expect: p.expect ?? "high" }));
}

function evaluate(pair: Pair): ComparisonResult {
  const strategy = defaultRegistry.get(pair.strategy)!;
  const [reference] = extractReferenceFeatures(pair.reference, [strategy]).features;
  const [input] = extractReferenceFeatures(pair.input, [strategy]).features;
  return strategy.compare(input!, reference!);
}

const pairs = [...syntheticPairs(), ...realPairs()];
const byLabel = new Map<string, { expect: Pair["expect"]; scores: number[] }>();
for (const pair of pairs) {
  const result = evaluate(pair);
  const entry = byLabel.get(pair.label) ?? { expect: pair.expect, scores: [] };
  entry.scores.push(result.score);
  byLabel.set(pair.label, entry);
  if (verbose) {
    console.log(`${pair.label.padEnd(42)} ${result.score.toFixed(1).padStart(5)}  ${result.breakdown.map((b) => `${b.id}=${b.score.toFixed(0)} (${b.detail})`).join(" | ")}`);
  }
}

console.log("\nScore distribution by label (heuristic similarity, 0–100)\n");
console.log(`${"label".padEnd(42)} ${"expect".padEnd(6)} ${"n".padStart(3)} ${"min".padStart(6)} ${"median".padStart(6)} ${"max".padStart(6)}`);
for (const [label, { expect, scores }] of byLabel) {
  const fmt = (v: number) => v.toFixed(1).padStart(6);
  console.log(`${label.padEnd(42)} ${expect.padEnd(6)} ${String(scores.length).padStart(3)} ${fmt(Math.min(...scores))} ${fmt(median(scores))} ${fmt(Math.max(...scores))}`);
}
console.log("\nexpect: high ≳ 80, mid ≈ 30–80, low ≲ 30. Synthetic pairs check sanity, not real-world accuracy.");
