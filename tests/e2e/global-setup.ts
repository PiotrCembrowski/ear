/**
 * Writes the WAV that Chromium's fake microphone plays (on a loop):
 * 1.2 s near-silence, 2 s of a SYNTHETIC A4 tone, 1 s near-silence.
 * Synthetic audio is used only in tests.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encodeWav16 } from "../../src/lib/audio-engine/wav";
import { concat, harmonicTone, mix, silence, whiteNoise } from "../audio/synthetic";

export default function globalSetup() {
  const sampleRate = 48000;
  const tone = harmonicTone(440, 2, sampleRate, { harmonics: [1, 0.5, 0.25, 0.12], attackSeconds: 0.02, amplitude: 0.35 });
  const body = concat(silence(1.2, sampleRate), tone, silence(1, sampleRate));
  const samples = mix(body, whiteNoise(body.length / sampleRate, sampleRate, 0.002, 5));
  const file = path.resolve("tests/e2e/.generated/fake-mic.wav");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodeWav16({ samples, sampleRate }));
}
