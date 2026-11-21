/**
 * Streaming sample-rate converter (windowed-sinc interpolation).
 *
 * Why: microphones run at 44.1 kHz, 48 kHz or other rates, and the engine
 * analyses everything at ANALYSIS_SAMPLE_RATE (22,050 Hz). Simply dropping
 * samples would fold frequencies above the new Nyquist limit back into the
 * audible range ("aliasing"), creating false tones that would confuse pitch
 * detection. A windowed-sinc low-pass filter removes them first.
 *
 * How:
 *  - Output sample n sits at input position x = n · (inputRate / outputRate).
 *    The position is computed with exact integer arithmetic, so results are
 *    bit-identical however the input is split into blocks.
 *  - Its value is Σ input[k] · h(x − k) over the ±halfWidth input samples
 *    around x, where h is a sinc low-pass at the lower of the two Nyquist
 *    frequencies (×0.97 guard band) shaped by a Blackman window.
 *  - h is pre-computed into a fine table (512 steps per input sample) and
 *    linearly interpolated, which is far cheaper than evaluating sin() for
 *    every tap and accurate to better than −90 dB.
 */
import { ANALYSIS_SAMPLE_RATE } from "./constants";

const TABLE_STEPS_PER_SAMPLE = 512;
/** Filter length in zero-crossings each side. 16 gives a steep, clean low-pass. */
const DEFAULT_HALF_TAPS = 16;
/** Keep the passband slightly below Nyquist so the transition band attenuates before it. */
const CUTOFF_GUARD = 0.97;

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function blackman(u: number): number {
  // u in [-1, 1]; 0 at the edges, 1 at the center.
  return 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
}

export class StreamingResampler {
  readonly inputRate: number;
  readonly outputRate: number;
  private readonly passThrough: boolean;
  private readonly halfWidth: number;
  private readonly table: Float64Array;

  /** Input samples not yet fully used; `bufferStart` is the absolute index of buffer[0]. */
  private buffer = new Float64Array(0);
  private bufferLength = 0;
  private bufferStart = 0;
  /** Total input samples received so far. */
  private received = 0;
  /** Absolute index of the next output sample. */
  private nextOutput = 0;

  constructor(inputRate: number, outputRate: number = ANALYSIS_SAMPLE_RATE, halfTaps: number = DEFAULT_HALF_TAPS) {
    if (!Number.isInteger(inputRate) || !Number.isInteger(outputRate) || inputRate <= 0 || outputRate <= 0) {
      throw new RangeError("Sample rates must be positive integers.");
    }
    this.inputRate = inputRate;
    this.outputRate = outputRate;
    this.passThrough = inputRate === outputRate;

    // Cutoff as a fraction of the INPUT Nyquist frequency. When downsampling
    // (e.g. 48k → 22.05k) it is outputRate / inputRate ≈ 0.46.
    const ratio = Math.min(1, outputRate / inputRate);
    const cutoff = ratio * CUTOFF_GUARD;
    // Widen the filter in input samples when the cutoff is lower, so it keeps
    // the same number of zero-crossings (same steepness).
    this.halfWidth = Math.ceil(halfTaps / ratio);

    const size = this.halfWidth * TABLE_STEPS_PER_SAMPLE + 2;
    this.table = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const t = i / TABLE_STEPS_PER_SAMPLE; // distance from the output position, in input samples
      this.table[i] = t >= this.halfWidth ? 0 : cutoff * sinc(cutoff * t) * blackman(t / this.halfWidth);
    }
  }

  /** Feeds input samples; returns every output sample that can now be computed. */
  push(block: ArrayLike<number>): Float32Array {
    if (this.passThrough) {
      this.received += block.length;
      return Float32Array.from(block);
    }
    this.append(block);
    // Output n needs input up to floor(x) + halfWidth, which must already exist.
    return this.produce(false);
  }

  /** Signals end of input: computes the remaining outputs, treating later input as silence. */
  flush(): Float32Array {
    if (this.passThrough) return new Float32Array(0);
    return this.produce(true);
  }

  reset(): void {
    this.bufferLength = 0;
    this.bufferStart = 0;
    this.received = 0;
    this.nextOutput = 0;
  }

  private append(block: ArrayLike<number>): void {
    const needed = this.bufferLength + block.length;
    if (needed > this.buffer.length) {
      const grown = new Float64Array(Math.max(needed, this.buffer.length * 2, 1024));
      grown.set(this.buffer.subarray(0, this.bufferLength));
      this.buffer = grown;
    }
    for (let i = 0; i < block.length; i++) this.buffer[this.bufferLength + i] = block[i]!;
    this.bufferLength += block.length;
    this.received += block.length;
  }

  private produce(final: boolean): Float32Array {
    const { inputRate, outputRate, halfWidth, table } = this;
    // Total outputs that correspond to the input received so far.
    const totalOutputs = Math.ceil((this.received * outputRate) / inputRate);
    const out: number[] = [];

    while (this.nextOutput < totalOutputs) {
      // Exact position: integer part and fraction of n · inputRate / outputRate.
      const numerator = this.nextOutput * inputRate;
      const center = Math.floor(numerator / outputRate);
      const fraction = (numerator - center * outputRate) / outputRate;
      if (!final && center + halfWidth >= this.received) break; // not enough input yet

      let sum = 0;
      const first = center - halfWidth + 1;
      const last = center + halfWidth;
      for (let k = first; k <= last; k++) {
        const index = k - this.bufferStart;
        if (index < 0 || index >= this.bufferLength) continue; // before start / after end: silence
        const distance = Math.abs(center + fraction - k) * TABLE_STEPS_PER_SAMPLE;
        const i = Math.floor(distance);
        const w = distance - i;
        sum += this.buffer[index]! * (table[i]! * (1 - w) + table[i + 1]! * w);
      }
      out.push(sum);
      this.nextOutput++;
    }

    this.discardUsedInput();
    return Float32Array.from(out);
  }

  /** Drops input that no future output sample can reach, keeping memory bounded. */
  private discardUsedInput(): void {
    const nextCenter = Math.floor((this.nextOutput * this.inputRate) / this.outputRate);
    const keepFrom = nextCenter - this.halfWidth + 1;
    const drop = Math.min(this.bufferLength, Math.max(0, keepFrom - this.bufferStart));
    if (drop > 0) {
      this.buffer.copyWithin(0, drop, this.bufferLength);
      this.bufferLength -= drop;
      this.bufferStart += drop;
    }
  }
}

/** Batch helper: resamples a whole signal (same code path as streaming). */
export function resample(samples: Float32Array, inputRate: number, outputRate: number = ANALYSIS_SAMPLE_RATE): Float32Array {
  if (inputRate === outputRate) return samples.slice();
  const resampler = new StreamingResampler(inputRate, outputRate);
  const head = resampler.push(samples);
  const tail = resampler.flush();
  const out = new Float32Array(head.length + tail.length);
  out.set(head);
  out.set(tail, head.length);
  return out;
}
