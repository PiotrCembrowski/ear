/**
 * Runs the AudioWorklet processor in Node with stand-ins for the two worklet
 * globals it uses (AudioWorkletProcessor, registerProcessor).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { CAPTURE_PROCESSOR_NAME as MAIN_THREAD_NAME } from "../constants";

type Processor = { port: FakePort; process(inputs: Float32Array[][]): boolean };
type ProcessorClass = new (options: { processorOptions?: { batchSize?: number } }) => Processor;

class FakePort {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  sent: Array<{ message: { type: string; samples: Float32Array }; transfer: unknown[] }> = [];
  closed = false;
  postMessage(message: { type: string; samples: Float32Array }, transfer: unknown[] = []) {
    this.sent.push({ message, transfer });
  }
  close() {
    this.closed = true;
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

let registered: { name: string; processor: ProcessorClass } | null = null;
let workletName = "";

beforeAll(async () => {
  Object.assign(globalThis, {
    AudioWorkletProcessor: class {
      port = new FakePort();
    },
    registerProcessor: (name: string, processor: ProcessorClass) => {
      registered = { name, processor };
    },
  });
  workletName = (await import("./capture-processor")).CAPTURE_PROCESSOR_NAME;
});

function block(value: number) {
  return new Float32Array(128).fill(value);
}

describe("capture worklet", () => {
  it("registers under the name the main thread uses", () => {
    expect(registered?.name).toBe(workletName);
    expect(workletName).toBe(MAIN_THREAD_NAME);
  });

  it("downmixes to mono and sends fixed-size batches, transferring their buffers", () => {
    const processor = new registered!.processor({ processorOptions: { batchSize: 256 } });
    const worker = new FakePort();
    processor.port.receive({ type: "connect", port: worker });

    expect(processor.process([[block(0.2), block(0.6)]])).toBe(true); // 128 frames, stereo
    expect(worker.sent).toHaveLength(0);
    processor.process([[block(1), block(0)]]);
    expect(worker.sent).toHaveLength(1);
    const { message, transfer } = worker.sent[0]!;
    expect(message.type).toBe("audio");
    expect(message.samples).toHaveLength(256);
    expect(message.samples[0]).toBeCloseTo(0.4, 6);
    expect(message.samples[200]).toBeCloseTo(0.5, 6);
    expect(transfer).toEqual([message.samples.buffer]);
  });

  it("drops audio until the worker is connected, and keeps running with no input", () => {
    const processor = new registered!.processor({ processorOptions: { batchSize: 128 } });
    expect(processor.process([[block(0.5)]])).toBe(true);
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([])).toBe(true);
  });

  it("stops for good on 'stop', closing the worker port", () => {
    const processor = new registered!.processor({ processorOptions: { batchSize: 128 } });
    const worker = new FakePort();
    processor.port.receive({ type: "connect", port: worker });
    processor.port.receive({ type: "stop" });
    expect(worker.closed).toBe(true);
    expect(processor.process([[block(0.5)]])).toBe(false);
    expect(worker.sent).toHaveLength(0);
  });
});
