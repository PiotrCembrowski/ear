import { describe, expect, it } from "vitest";
import {
  concat,
  gain,
  mix,
  seededRandom,
  sine,
  silence,
  syntheticFluteNote,
  syntheticPianoNote,
  whiteNoise,
} from "../../../tests/audio/synthetic";
import { detectEvents, SoundEventDetector, type DetectorOutput } from "./event-detector";

const SR = 48000;
const ms = (samples: number) => (samples / SR) * 1000;

/** −50 dBFS-ish background hiss, seeded. */
const hiss = (seconds: number, seed: number) => whiteNoise(seconds, SR, 0.0055, seed);

describe("sound-event detection", () => {
  it("finds the start and end of a tone surrounded by silence and noise", () => {
    const tone = mix(sine(440, 1.0, SR, 0.25), hiss(1.0, 2));
    const clip = concat(hiss(0.6, 1), tone, hiss(0.6, 3), silence(0.3, SR));
    const events = detectEvents(clip, SR);

    expect(events).toHaveLength(1);
    const [event] = events;
    expect(Math.abs(ms(event!.onsetSample) - 600)).toBeLessThan(25);
    expect(Math.abs(ms(event!.offsetSample) - 1600)).toBeLessThan(30);
    expect(event!.reason).toBe("silence");
    expect(event!.tooShort).toBe(false);
    // Pre-roll: the event audio starts ~100 ms before the onset, and ends after the 200 ms hangover.
    const audioMs = ms(event!.samples.length);
    expect(audioMs).toBeGreaterThan(1000 + 100 + 150);
    expect(audioMs).toBeLessThan(1000 + 100 + 260);
  });

  it("works on digital silence as well as hiss", () => {
    const events = detectEvents(concat(silence(0.5, SR), sine(220, 0.5, SR, 0.3), silence(0.5, SR)), SR);
    expect(events).toHaveLength(1);
    expect(Math.abs(ms(events[0]!.onsetSample) - 500)).toBeLessThan(25);
  });

  it("splits two notes played back to back without a gap", () => {
    const clip = concat(silence(0.4, SR), syntheticFluteNote(69, 0.8, SR), syntheticFluteNote(74, 0.8, SR, 8), silence(0.6, SR));
    const events = detectEvents(clip, SR);
    expect(events).toHaveLength(2);
    expect(events[0]!.reason).toBe("new_onset");
    expect(Math.abs(ms(events[0]!.offsetSample) - 1200)).toBeLessThan(30);
    expect(Math.abs(ms(events[1]!.onsetSample) - 1200)).toBeLessThan(30);
  });

  it("does not split a steady note with slight vibrato, or a decaying piano note", () => {
    const flute = concat(silence(0.3, SR), syntheticFluteNote(64, 2, SR), silence(0.6, SR));
    expect(detectEvents(mix(flute, hiss(3, 5)), SR)).toHaveLength(1);
    const piano = concat(silence(0.3, SR), syntheticPianoNote(48, 2.5, SR), silence(0.6, SR));
    expect(detectEvents(mix(piano, hiss(3.4, 6)), SR)).toHaveLength(1);
  });

  it("cuts sounds at 5 s and does not retrigger until the sound stops", () => {
    const clip = concat(silence(0.3, SR), sine(330, 7, SR, 0.3), silence(0.5, SR));
    const events = detectEvents(clip, SR);
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe("max_duration");
    expect(Math.abs(events[0]!.durationMs - 5000)).toBeLessThan(15);
  });

  it("marks very short sounds as too short", () => {
    const clip = concat(silence(0.4, SR), gain(whiteNoise(0.04, SR, 0.5, 9), 1), silence(0.5, SR));
    const events = detectEvents(clip, SR);
    expect(events).toHaveLength(1);
    expect(events[0]!.tooShort).toBe(true);
  });

  it("ignores sounds below the sensitivity threshold", () => {
    const clip = concat(hiss(0.5, 1), mix(sine(440, 0.5, SR, 0.008), hiss(0.5, 2)), hiss(0.5, 3));
    expect(detectEvents(clip, SR, { sensitivityDb: 18 })).toHaveLength(0);
    expect(detectEvents(clip, SR, { sensitivityDb: 6 })).toHaveLength(1);
  });

  it("gives identical results for 128-sample blocks and large blocks", () => {
    const clip = concat(hiss(0.5, 1), syntheticPianoNote(60, 1, SR), syntheticPianoNote(67, 1, SR), hiss(0.5, 4));
    const large = detectEvents(clip, SR, {}, 8192);
    const small = detectEvents(clip, SR, {}, 128);
    expect(small.map(({ samples, ...rest }) => ({ ...rest, length: samples.length }))).toEqual(
      large.map(({ samples, ...rest }) => ({ ...rest, length: samples.length })),
    );
    expect(Array.from(small[0]!.samples)).toEqual(Array.from(large[0]!.samples));
  });

  it("works at other sample rates and with irregular block sizes", () => {
    const rate = 44100;
    const clip = concat(silence(0.5, rate), sine(523.25, 0.6, rate, 0.2), silence(0.5, rate));
    const detector = new SoundEventDetector(rate);
    const random = seededRandom(3);
    const outputs: DetectorOutput[] = [];
    for (let offset = 0; offset < clip.length; ) {
      const size = 1 + Math.floor(random() * 900);
      outputs.push(...detector.process(clip.subarray(offset, offset + size)));
      offset += size;
    }
    outputs.push(...detector.flush());
    const ends = outputs.filter((o) => o.type === "end");
    expect(ends).toHaveLength(1);
    expect(Math.abs(((ends[0] as { onsetSample: number }).onsetSample / rate) * 1000 - 500)).toBeLessThan(25);
  });
});
