/**
 * Analysis Web Worker: runs the audio engine off the main thread, so heavy
 * DSP never makes the UI stutter.
 *
 *   worklet ──(MessagePort: audio batches)──▶ this worker ──(readings, results)──▶ UI
 *
 * Audio batches are analysed and immediately discarded. Nothing here can
 * reach the network: the worker has no code that sends data anywhere except
 * back to the page.
 */
import { ListeningSession } from "@/lib/audio-engine/listening-session";
import { READING_INTERVAL_MS } from "./constants";
import type { WorkerRequest, WorkerResponse } from "./protocol";

// The project's TypeScript config uses the DOM library, so describe the
// dedicated-worker scope we rely on explicitly.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

let session: ListeningSession | null = null;
let audioPort: MessagePort | null = null;
let samplesSinceReading = 0;
let readingInterval = 0;

function post(message: WorkerResponse): void {
  scope.postMessage(message);
}

function onAudio(event: MessageEvent<{ type: "audio"; samples: Float32Array }>): void {
  if (!session || event.data?.type !== "audio") return;
  try {
    const events = session.push(event.data.samples);
    if (events.length > 0) post({ type: "events", events });
    samplesSinceReading += event.data.samples.length;
    if (samplesSinceReading >= readingInterval) {
      samplesSinceReading = 0;
      post({ type: "reading", snapshot: session.snapshot() });
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

function stop(): void {
  if (session) {
    const events = session.flush();
    if (events.length > 0) post({ type: "events", events });
  }
  audioPort?.close();
  audioPort = null;
  session = null;
  post({ type: "stopped" });
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    switch (message.type) {
      case "start":
        stop();
        session = new ListeningSession(message.sampleRate, message.options);
        readingInterval = Math.round((READING_INTERVAL_MS / 1000) * message.sampleRate);
        samplesSinceReading = 0;
        audioPort = message.audioPort;
        audioPort.onmessage = onAudio;
        post({ type: "ready" });
        break;
      case "set-sensitivity":
        session?.setSensitivity(message.sensitivityDb);
        break;
      case "set-a4":
        session?.setA4(message.a4Hz);
        break;
      case "stop":
        stop();
        break;
    }
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
