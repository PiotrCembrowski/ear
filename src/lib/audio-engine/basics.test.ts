import { describe, expect, it } from "vitest";
import { concat, seededRandom, sine, whiteNoise } from "../../../tests/audio/synthetic";
import { amplitudeToDb, centsBetween, median, percentile, resampleSeries } from "./math";
import { midiToHz, midiToNoteName, midiToSafeNoteName, nearestNote, parseNote } from "./notes";
import { resample, StreamingResampler } from "./resampler";
import { decodeWav, encodeWav16, WavFormatError } from "./wav";

function rms(signal: Float32Array, from = 0, to = signal.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += signal[i]! ** 2;
  return Math.sqrt(sum / (to - from));
}

/** Estimates a sine's frequency from zero crossings (good enough to check resampling). */
function zeroCrossingFrequency(signal: Float32Array, sampleRate: number): number {
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = 1; i < signal.length; i++) {
    if (signal[i - 1]! < 0 && signal[i]! >= 0) {
      const t = i - 1 + -signal[i - 1]! / (signal[i]! - signal[i - 1]!);
      if (first < 0) first = t;
      last = t;
      count++;
    }
  }
  return ((count - 1) * sampleRate) / (last - first);
}

describe("math", () => {
  it("computes percentiles, medians and dB", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(percentile([0, 10], 25)).toBe(2.5);
    expect(amplitudeToDb(1)).toBe(0);
    expect(amplitudeToDb(0)).toBe(-120);
    expect(centsBetween(880, 440)).toBeCloseTo(1200, 9);
    expect(resampleSeries([0, 10], 3)).toEqual([0, 5, 10]);
  });
});

describe("notes", () => {
  it("converts between MIDI, names and frequency", () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(60)).toBeCloseTo(261.6256, 4);
    expect(midiToHz(69, 442)).toBe(442);
    expect(midiToNoteName(21)).toBe("A0");
    expect(midiToNoteName(108)).toBe("C8");
    expect(midiToNoteName(70)).toBe("A#4");
    expect(midiToSafeNoteName(70)).toBe("As4");
    expect(midiToNoteName(0)).toBe("C-1");
  });

  it("finds the nearest note and the cents offset", () => {
    const n = nearestNote(440 * 2 ** (7 / 1200));
    expect(n.name).toBe("A4");
    expect(n.cents).toBeCloseTo(7, 9);
    expect(nearestNote(261.63).name).toBe("C4");
    expect(nearestNote(442, 442).cents).toBeCloseTo(0, 9);
  });

  it.each([
    ["A4", 69],
    ["A#4", 70],
    ["As4", 70],
    ["Bb4", 70],
    ["A-sharp-4", 70],
    ["B-flat-4", 70],
    ["bb4", 70],
    ["C-1", 0],
    ["C8", 108],
    ["69", 69],
    ["021", 21],
  ])("parses %s as MIDI %i", (text, midi) => {
    expect(parseNote(text)).toBe(midi);
  });

  it.each(["H4", "A", "A44", "X#4", "128", "piano"])("rejects %s", (text) => {
    expect(parseNote(text)).toBeNull();
  });
});

describe("WAV", () => {
  it("round-trips 16-bit PCM within half a quantization step", () => {
    const samples = sine(440, 0.1, 22050, 0.8);
    const decoded = decodeWav(encodeWav16({ samples, sampleRate: 22050 }));
    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.info).toMatchObject({ channels: 1, bitsPerSample: 16, format: "pcm", frameCount: samples.length });
    for (let i = 0; i < samples.length; i++) expect(Math.abs(decoded.samples[i]! - samples[i]!)).toBeLessThanOrEqual(0.5 / 32768);
  });

  it("clips out-of-range samples instead of wrapping around", () => {
    const decoded = decodeWav(encodeWav16({ samples: Float32Array.from([1.5, -1.5]), sampleRate: 8000 }));
    expect(decoded.samples[0]).toBeCloseTo(32767 / 32768, 6);
    expect(decoded.samples[1]).toBe(-1);
  });

  it("decodes stereo 24-bit and 32-bit float files with extra chunks, downmixing to mono", () => {
    // Hand-built file: RIFF, a LIST chunk to skip, fmt (EXTENSIBLE → float32 stereo), data.
    const frames = [
      [0.5, -0.5],
      [0.25, 0.75],
    ];
    const fmtSize = 40;
    const data = new DataView(new ArrayBuffer(frames.length * 8));
    frames.forEach(([l, r], i) => {
      data.setFloat32(i * 8, l!, true);
      data.setFloat32(i * 8 + 4, r!, true);
    });
    const parts: number[] = [];
    const push4cc = (s: string) => [...s].forEach((c) => parts.push(c.charCodeAt(0)));
    const pushU32 = (v: number) => parts.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255);
    const pushU16 = (v: number) => parts.push(v & 255, (v >> 8) & 255);
    push4cc("RIFF");
    pushU32(0); // size not checked
    push4cc("WAVE");
    push4cc("LIST");
    pushU32(3);
    parts.push(1, 2, 3, 0); // odd size + pad byte
    push4cc("fmt ");
    pushU32(fmtSize);
    pushU16(0xfffe);
    pushU16(2);
    pushU32(48000);
    pushU32(48000 * 8);
    pushU16(8);
    pushU16(32);
    pushU16(22); // cbSize
    pushU16(32); // valid bits
    pushU32(3); // channel mask
    pushU16(3); // SubFormat GUID starts with IEEE_FLOAT
    for (let i = 0; i < 14; i++) parts.push(0);
    push4cc("data");
    pushU32(data.byteLength);
    parts.push(...new Uint8Array(data.buffer));

    const decoded = decodeWav(Uint8Array.from(parts));
    expect(decoded.info).toMatchObject({ channels: 2, sampleRate: 48000, format: "float", bitsPerSample: 32 });
    expect(Array.from(decoded.samples)).toEqual([0, 0.5]);
  });

  it("rejects files that are not WAV, or use unsupported encodings", () => {
    expect(() => decodeWav(new TextEncoder().encode("ID3 not a wav file at all"))).toThrow(WavFormatError);
    const adpcm = encodeWav16({ samples: new Float32Array(4), sampleRate: 8000 });
    new DataView(adpcm.buffer).setUint16(20, 2, true); // MS ADPCM
    expect(() => decodeWav(adpcm)).toThrow(/Unsupported WAV encoding/);
  });
});

describe("resampler", () => {
  it.each([44100, 48000, 96000, 16000])("keeps a 1 kHz tone's frequency and level from %i Hz to 22,050 Hz", (rate) => {
    const out = resample(sine(1000, 0.5, rate, 0.5), rate, 22050);
    expect(out.length).toBe(Math.ceil((Math.round(0.5 * rate) * 22050) / rate));
    const middle = out.subarray(1000, out.length - 1000); // skip filter edges
    expect(zeroCrossingFrequency(middle, 22050)).toBeCloseTo(1000, 1);
    expect(rms(middle)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("removes frequencies above the new Nyquist limit instead of aliasing them", () => {
    // 15 kHz at 48 kHz would alias to 7.05 kHz at 22.05 kHz without filtering.
    const out = resample(sine(15000, 0.5, 48000, 0.5), 48000, 22050);
    expect(amplitudeToDb(rms(out, 1000, out.length - 1000))).toBeLessThan(-70);
  });

  it("gives bit-identical output for any block size (streaming = batch)", () => {
    const random = seededRandom(42);
    const input = concat(whiteNoise(0.2, 48000, 0.4, 3), sine(523.25, 0.3, 48000));
    const batch = resample(input, 48000, 22050);

    const streamer = new StreamingResampler(48000, 22050);
    const chunks: Float32Array[] = [];
    for (let offset = 0; offset < input.length; ) {
      const size = 1 + Math.floor(random() * 700); // irregular block sizes, including 1
      chunks.push(streamer.push(input.subarray(offset, offset + size)));
      offset += size;
    }
    chunks.push(streamer.flush());
    const streamed = concat(...chunks);
    expect(streamed.length).toBe(batch.length);
    expect(Array.from(streamed)).toEqual(Array.from(batch));
  });

  it("passes audio through unchanged when the rates match", () => {
    const input = sine(440, 0.01, 22050);
    expect(Array.from(resample(input, 22050, 22050))).toEqual(Array.from(input));
  });
});
