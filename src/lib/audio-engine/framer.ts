/**
 * Splits a stream of samples into overlapping analysis frames.
 *
 * Frame k covers samples [k·hop, k·hop + frameSize). Frames are emitted as
 * soon as enough samples have arrived, so the output is identical whatever
 * block sizes the input comes in (this is what makes streaming and batch
 * analysis agree).
 *
 * Only `frameSize` samples are ever kept, never the whole stream.
 */
export class Framer {
  readonly frameSize: number;
  readonly hopSize: number;
  private readonly buffer: Float32Array;
  private filled = 0;
  private framesEmitted = 0;

  constructor(frameSize: number, hopSize: number) {
    if (hopSize <= 0 || hopSize > frameSize) throw new RangeError("hopSize must be in 1..frameSize");
    this.frameSize = frameSize;
    this.hopSize = hopSize;
    this.buffer = new Float32Array(frameSize);
  }

  get frameCount(): number {
    return this.framesEmitted;
  }

  /**
   * Adds samples; calls `onFrame` for every completed frame. The frame array
   * is reused: copy it if you need to keep it after the callback returns.
   */
  push(samples: ArrayLike<number>, onFrame: (frame: Float32Array, index: number) => void): void {
    let offset = 0;
    while (offset < samples.length) {
      const take = Math.min(this.frameSize - this.filled, samples.length - offset);
      for (let i = 0; i < take; i++) this.buffer[this.filled + i] = samples[offset + i]!;
      this.filled += take;
      offset += take;
      if (this.filled === this.frameSize) {
        onFrame(this.buffer, this.framesEmitted++);
        // Slide by one hop: keep the last (frameSize − hop) samples.
        this.buffer.copyWithin(0, this.hopSize);
        this.filled = this.frameSize - this.hopSize;
      }
    }
  }

  /**
   * For very short sounds: if no complete frame was ever produced, emits one
   * zero-padded frame from what arrived, so short events still get features.
   */
  flushIfEmpty(onFrame: (frame: Float32Array, index: number) => void): void {
    if (this.framesEmitted > 0 || this.filled === 0) return;
    this.buffer.fill(0, this.filled);
    onFrame(this.buffer, this.framesEmitted++);
  }

  reset(): void {
    this.filled = 0;
    this.framesEmitted = 0;
    this.buffer.fill(0);
  }
}
