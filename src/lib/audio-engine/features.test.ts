/**
 * Cross-checks our in-house features against Meyda (a dev-only dependency).
 *
 * The two libraries differ in a few documented conventions, so each check
 * either aligns them or allows a stated tolerance:
 *  - Meyda computes RMS and zero crossings on the WINDOWED frame; we compare
 *    against Meyda with its rectangular window ("rect") for those two.
 *  - Meyda's centroid is in FFT bins (we convert to Hz) and uses a symmetric
 *    Hann window (we use the periodic one): ≤ 1% difference.
 *  - Meyda's rolloff uses 99% of amplitude; we call ours with fraction 0.99.
 *  - Meyda's MFCC uses log(x + 1), mel filters snapped to whole FFT bins, and
 *    an unnormalized DCT (×2). On a loud broadband signal log(x+1) ≈ log(x),
 *    and our orthonormal DCT relates by a factor √(2·bands), so coefficients
 *    c1..c12 should agree closely in shape (correlation) and size.
 */
import Meyda from "meyda";
import { describe, expect, it } from "vitest";
import { harmonicTone, mix, sine, whiteNoise } from "../../../tests/audio/synthetic";
import {
  createMelFilterbank,
  melEnergies,
  mfccFromMelEnergies,
  rms,
  spectralCentroid,
  spectralRolloff,
  zeroCrossings,
} from "./features";
import { SpectrumAnalyzer } from "./spectrum";

const SR = 22050;
const N = 1024;

function configureMeyda() {
  Meyda.bufferSize = N;
  Meyda.sampleRate = SR;
  Meyda.melBands = 26;
  Meyda.numberOfMFCCCoefficients = 13;
  Meyda.windowingFunction = "hanning";
}

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i]! - ma) * (b[i]! - mb);
    da += (a[i]! - ma) ** 2;
    db += (b[i]! - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

const frames: Record<string, Float32Array> = {
  "harmonic tone": harmonicTone(330, N / SR, SR, { harmonics: [1, 0.6, 0.4, 0.3, 0.2, 0.1], amplitude: 0.8 }),
  "noisy tone": mix(sine(880, N / SR, SR, 0.5), whiteNoise(N / SR, SR, 0.2, 4)),
  "white noise": whiteNoise(N / SR, SR, 0.9, 8),
};

describe("features agree with Meyda", () => {
  configureMeyda();
  const analyzer = new SpectrumAnalyzer(N);

  for (const [name, frame] of Object.entries(frames)) {
    describe(name, () => {
      const ours = analyzer.magnitudes(frame, new Float64Array(analyzer.binCount));
      Meyda.windowingFunction = "rect";
      const timeDomain = Meyda.extract(["rms", "zcr"], frame) as { rms: number; zcr: number };
      Meyda.windowingFunction = "hanning";
      const meyda = Meyda.extract(["spectralCentroid", "spectralRolloff"], frame) as {
        spectralCentroid: number;
        spectralRolloff: number;
      };

      it("RMS and zero crossings match exactly", () => {
        expect(rms(frame)).toBeCloseTo(timeDomain.rms, 6);
        expect(zeroCrossings(frame)).toBe(timeDomain.zcr);
      });

      it("spectral centroid matches within 1%", () => {
        const meydaHz = (meyda.spectralCentroid * SR) / N;
        expect(Math.abs(spectralCentroid(ours, SR, N) - meydaHz) / meydaHz).toBeLessThan(0.01);
      });

      it("spectral rolloff (99%) matches within 2 FFT bins", () => {
        const binHz = SR / N;
        expect(Math.abs(spectralRolloff(ours, SR, N, 0.99) - meyda.spectralRolloff)).toBeLessThanOrEqual(2 * binHz + 1e-6);
      });
    });
  }

  it("MFCC c1..c12 match on a loud broadband signal (shape and size)", () => {
    const frame = frames["white noise"]!;
    const meydaMfcc = (Meyda.extract("mfcc", frame) as number[]).slice(1, 13);

    // Meyda passes raw |FFT| (no 2/Σw scaling) to its mel bank, so undo our scaling.
    const mags = analyzer.magnitudes(frame, new Float64Array(analyzer.binCount));
    const unscale = N / 4; // = 1 / (2 / Σw) for a periodic Hann window (Σw = N/2)
    const raw = mags.map((m) => m * unscale);
    const bank = createMelFilterbank(SR, N, 26, 0, SR / 2);
    const energies = melEnergies(raw, bank, new Float64Array(26));
    const ours = Array.from(mfccFromMelEnergies(energies, 13, new Float64Array(13))).slice(1, 13);
    const scaled = ours.map((c) => c * Math.sqrt(2 * 26));

    expect(correlation(scaled, meydaMfcc)).toBeGreaterThan(0.95);
    const meanAbsDiff = scaled.reduce((s, c, i) => s + Math.abs(c - meydaMfcc[i]!), 0) / 12;
    const meanAbs = meydaMfcc.reduce((s, c) => s + Math.abs(c), 0) / 12;
    expect(meanAbsDiff / meanAbs).toBeLessThan(0.25);
  });
});

describe("our feature conventions", () => {
  const analyzer = new SpectrumAnalyzer(2048);

  it("a full-scale sine reads ≈ 1.0 at its peak bin (FFT-size independent scaling)", () => {
    // 21 cycles in 2048 samples → exactly on bin 21, no leakage between bins
    const hz = (21 * SR) / 2048;
    const mags = analyzer.magnitudes(sine(hz, 2048 / SR, SR, 1), new Float64Array(analyzer.binCount));
    expect(Math.max(...mags)).toBeCloseTo(1, 3);
  });

  it("a loudness change only moves MFCC c0", () => {
    const bank = createMelFilterbank(SR, 2048, 26, 30, 8000);
    const frame = frames["harmonic tone"]!;
    const padded = new Float32Array(2048);
    padded.set(frame);
    const mfcc = (scale: number) => {
      const mags = analyzer.magnitudes(padded.map((v) => v * scale), new Float64Array(analyzer.binCount));
      return Array.from(mfccFromMelEnergies(melEnergies(mags, bank, new Float64Array(26)), 13, new Float64Array(13)));
    };
    const loud = mfcc(1);
    const quiet = mfcc(0.1);
    expect(loud[0]! - quiet[0]!).toBeGreaterThan(5);
    for (let k = 1; k < 13; k++) expect(quiet[k]).toBeCloseTo(loud[k]!, 6);
  });
});
