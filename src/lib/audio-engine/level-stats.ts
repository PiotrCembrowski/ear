/**
 * Loudness statistics of a sound event, measured on the ORIGINAL input
 * samples (before resampling, so clipping is detected exactly as recorded).
 */
import { amplitudeToDb, round } from "./math";

export type EventStats = {
  durationMs: number;
  /** Overall RMS level, dBFS. */
  rmsDb: number;
  /** Highest absolute sample, dBFS (0 = full scale). */
  peakDb: number;
  /** Fraction of samples at or above 99.9% of full scale (likely clipped). */
  clippedFraction: number;
};

const CLIP_LEVEL = 0.999;

export class LevelStats {
  private readonly sampleRate: number;
  private count = 0;
  private sumSquares = 0;
  private peak = 0;
  private clipped = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  push(block: ArrayLike<number>): void {
    for (let i = 0; i < block.length; i++) {
      const v = block[i]!;
      const a = v < 0 ? -v : v;
      this.sumSquares += v * v;
      if (a > this.peak) this.peak = a;
      if (a >= CLIP_LEVEL) this.clipped++;
    }
    this.count += block.length;
  }

  get elapsedMs(): number {
    return (this.count / this.sampleRate) * 1000;
  }

  result(): EventStats {
    return {
      durationMs: round(this.elapsedMs, 1),
      rmsDb: round(amplitudeToDb(this.count ? Math.sqrt(this.sumSquares / this.count) : 0), 2),
      peakDb: round(amplitudeToDb(this.peak), 2),
      clippedFraction: round(this.count ? this.clipped / this.count : 0, 5),
    };
  }

  reset(): void {
    this.count = 0;
    this.sumSquares = 0;
    this.peak = 0;
    this.clipped = 0;
  }
}
