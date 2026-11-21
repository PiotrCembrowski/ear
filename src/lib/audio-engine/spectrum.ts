/**
 * Magnitude spectrum of one frame, via fft.js (radix-4 real FFT).
 *
 * Each frame is multiplied by a periodic Hann window first, which tapers its
 * edges to zero and greatly reduces "spectral leakage" (energy smearing into
 * neighbouring bins because the frame cuts the waveform mid-cycle).
 *
 * Magnitudes are scaled by 2 / Σwindow, so a full-scale sine reads ≈ 1.0 at
 * its peak bin whatever the FFT size. That makes values comparable across
 * sample rates and frame sizes.
 */
import FFT from "fft.js";

export class SpectrumAnalyzer {
  readonly size: number;
  readonly binCount: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly windowed: Float64Array;
  private readonly complex: number[];
  private readonly scale: number;

  constructor(size: number) {
    if (size < 16 || (size & (size - 1)) !== 0) throw new RangeError("FFT size must be a power of two ≥ 16");
    this.size = size;
    this.binCount = size / 2 + 1; // 0 Hz … Nyquist
    this.fft = new FFT(size);
    this.complex = this.fft.createComplexArray();
    this.windowed = new Float64Array(size);
    this.window = new Float64Array(size);
    let sum = 0;
    for (let n = 0; n < size; n++) {
      this.window[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / size); // periodic Hann
      sum += this.window[n]!;
    }
    this.scale = 2 / sum;
  }

  /** Writes |X[k]| for k = 0 … size/2 into `out` (length binCount). Frame length must equal `size`. */
  magnitudes(frame: ArrayLike<number>, out: Float64Array): Float64Array {
    for (let n = 0; n < this.size; n++) this.windowed[n] = (frame[n] ?? 0) * this.window[n]!;
    this.fft.realTransform(this.complex, this.windowed);
    for (let k = 0; k < this.binCount; k++) {
      const re = this.complex[2 * k]!;
      const im = this.complex[2 * k + 1]!;
      out[k] = Math.sqrt(re * re + im * im) * this.scale;
    }
    return out;
  }
}
