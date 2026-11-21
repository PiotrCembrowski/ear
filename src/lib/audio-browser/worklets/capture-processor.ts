/**
 * AudioWorklet processor: the first stop for microphone audio.
 *
 * Runs on the browser's real-time audio thread, so it does as little as
 * possible:
 *   1. averages the input channels to mono;
 *   2. collects the 128-sample render blocks into batches of ~21 ms;
 *   3. transfers each batch (zero-copy) straight to the analysis Web Worker
 *      over a MessageChannel, bypassing the main (UI) thread.
 *
 * Nothing is stored: each batch is handed off and forgotten.
 *
 * This file is compiled on its own by `npm run build:worklets` (plain tsc)
 * into public/worklets/capture-processor.js, because worklets are loaded by
 * URL and must not import anything.
 */

// Globals of the AudioWorkletGlobalScope. TypeScript has no built-in library
// for it, so the few we use are declared here.
interface AudioWorkletProcessorShape {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: { prototype: AudioWorkletProcessorShape; new (): AudioWorkletProcessorShape };
declare function registerProcessor(name: string, processor: new (options: { processorOptions?: { batchSize?: number } }) => AudioWorkletProcessorShape): void;

export const CAPTURE_PROCESSOR_NAME = "soundmatch-capture";

/** Messages the main thread sends to this processor. */
type ControlMessage = { type: "connect"; port: MessagePort } | { type: "stop" };

class CaptureProcessor extends AudioWorkletProcessor {
  private readonly batchSize: number;
  private batch: Float32Array;
  private filled = 0;
  private output: MessagePort | null = null;
  private stopped = false;

  constructor(options: { processorOptions?: { batchSize?: number } }) {
    super();
    this.batchSize = Math.max(128, options.processorOptions?.batchSize ?? 1024);
    this.batch = new Float32Array(this.batchSize);
    this.port.onmessage = (event: MessageEvent<ControlMessage>) => {
      if (event.data.type === "connect") this.output = event.data.port;
      if (event.data.type === "stop") {
        this.stopped = true;
        this.output?.close();
        this.output = null;
      }
    };
  }

  /** Called by the browser for every 128-sample render block. Returning false lets the node be garbage-collected. */
  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true; // no input connected (yet)
    const frames = channels[0]!.length;
    const count = channels.length;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < count; c++) sum += channels[c]![i]!;
      this.batch[this.filled++] = sum / count;
      if (this.filled === this.batchSize) this.flush();
    }
    return true;
  }

  private flush(): void {
    const full = this.batch;
    this.batch = new Float32Array(this.batchSize);
    this.filled = 0;
    // Until the worker's port arrives (a few ms after start), batches are dropped.
    this.output?.postMessage({ type: "audio", samples: full }, [full.buffer]);
  }
}

registerProcessor(CAPTURE_PROCESSOR_NAME, CaptureProcessor);
