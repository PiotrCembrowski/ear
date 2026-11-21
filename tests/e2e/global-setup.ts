/**
 * Writes the test fixtures (SYNTHETIC audio, used only in tests):
 *  - fake-mic.wav: what Chromium's fake microphone plays on a loop
 *    (1.2 s near-silence, 2 s of an A4 tone, 1 s near-silence);
 *  - import/*: files for the admin importer, covering every preview status;
 *  - mislabelled/064_E4_v100.wav: named E4 but actually a C4.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeWav16 } from "../../src/lib/audio-engine/wav";
import { concat, harmonicTone, mix, silence, syntheticPianoNote, whiteNoise } from "../audio/synthetic";

export default function globalSetup() {
  const sampleRate = 48000;
  const tone = harmonicTone(440, 2, sampleRate, { harmonics: [1, 0.5, 0.25, 0.12], attackSeconds: 0.02, amplitude: 0.35 });
  const body = concat(silence(1.2, sampleRate), tone, silence(1, sampleRate));
  const samples = mix(body, whiteNoise(body.length / sampleRate, sampleRate, 0.002, 5));
  const file = path.resolve("tests/e2e/.generated/fake-mic.wav");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodeWav16({ samples, sampleRate }));

  const note = (midi: number) => encodeWav16({ samples: syntheticPianoNote(midi, 0.8, 44100), sampleRate: 44100 });
  const importDir = path.resolve("tests/e2e/.generated/import");
  mkdirSync(importDir, { recursive: true });
  writeFileSync(path.join(importDir, "060_C4_v80.wav"), note(60)); // ok
  writeFileSync(path.join(importDir, "A#4_v80.wav"), note(70)); // ok
  writeFileSync(path.join(importDir, "069_A4_v80.wav"), note(69)); // already stored → duplicate
  writeFileSync(path.join(importDir, "Bb4-v80.wav"), note(70)); // same note as A#4 v80 → duplicate
  writeFileSync(path.join(importDir, "C9.wav"), note(100)); // outside the piano → invalid name
  writeFileSync(path.join(importDir, "kick.wav"), note(40)); // no note in the name → invalid name
  writeFileSync(path.join(importDir, "notes.txt"), "not audio"); // unsupported format
  writeFileSync(path.join(importDir, "D5.mp3"), "this is not really an mp3"); // decode failure
  const mislabelledDir = path.resolve("tests/e2e/.generated/mislabelled");
  mkdirSync(mislabelledDir, { recursive: true });
  writeFileSync(path.join(mislabelledDir, "064_E4_v100.wav"), note(60));
}
