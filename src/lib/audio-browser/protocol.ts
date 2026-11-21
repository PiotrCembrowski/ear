/**
 * Messages between the UI thread and the analysis worker. Audio never
 * travels on this channel: it goes worklet → worker on its own MessagePort.
 */
import type { SessionEvent, SessionOptions, SessionSnapshot } from "@/lib/audio-engine/listening-session";

export type WorkerRequest =
  | { type: "start"; sampleRate: number; options: SessionOptions; audioPort: MessagePort }
  | { type: "set-sensitivity"; sensitivityDb: number }
  | { type: "set-a4"; a4Hz: number }
  /** Finish any sound in progress, then forget everything. */
  | { type: "stop" };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "reading"; snapshot: SessionSnapshot }
  | { type: "events"; events: SessionEvent[] }
  | { type: "stopped" }
  | { type: "error"; message: string };
