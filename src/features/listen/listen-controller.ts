/**
 * Orchestrates one Listen screen: microphone ↔ analysis worker ↔ UI stores.
 * Plain TypeScript (no React), so the lifecycle rules live in one place:
 *
 *  - start() must be called from a click/tap (iOS audio rules).
 *  - stop() stops every microphone track, so the browser's mic indicator turns off.
 *  - The tab going to the background stops listening (privacy, and iOS would
 *    suspend audio anyway); so do pagehide and leaving the page.
 *  - An unplugged device or an interrupted AudioContext is reported clearly.
 */
import type { SessionSnapshot } from "@/lib/audio-engine/listening-session";
import type { NoteReading } from "@/lib/audio-engine/strategies/pitch";
import type { QualityWarning } from "@/lib/audio-engine/types";
import { createAnalysisWorker } from "@/lib/audio-browser/analysis-client";
import { INPUT_DEVICE_STORAGE_KEY } from "@/lib/audio-browser/constants";
import {
  listInputDevices,
  MicrophoneError,
  startMicrophone,
  type InputDevice,
  type MicrophoneErrorCode,
  type MicrophoneHandle,
} from "@/lib/audio-browser/microphone";
import type { WorkerResponse } from "@/lib/audio-browser/protocol";
import { Store } from "@/lib/audio-browser/store";

export type ListenStatus = "idle" | "starting" | "listening" | "paused" | "error";
export type ListenErrorCode = MicrophoneErrorCode | "engine-failed";
export type PausedReason = "hidden" | "interrupted";

export type LastNote = {
  reading: NoteReading | null;
  warnings: QualityWarning[];
  durationMs: number;
  /** Increments per result, so the UI can announce/animate each new one. */
  sequence: number;
};

export type ListenState = {
  status: ListenStatus;
  errorCode: ListenErrorCode | null;
  pausedReason: PausedReason | null;
  devices: InputDevice[];
  /** The user's chosen device, or null for the system default. */
  selectedDeviceId: string | null;
  activeDeviceLabel: string | null;
  sampleRate: number | null;
  lowQualityInput: boolean;
  sensitivityDb: number;
  a4Hz: number;
  lastNote: LastNote | null;
};

function readStoredDevice(): string | null {
  try {
    return window.localStorage.getItem(INPUT_DEVICE_STORAGE_KEY);
  } catch {
    return null; // storage blocked (private mode, settings): fall back to the default device
  }
}

function storeDevice(deviceId: string | null): void {
  try {
    if (deviceId) window.localStorage.setItem(INPUT_DEVICE_STORAGE_KEY, deviceId);
    else window.localStorage.removeItem(INPUT_DEVICE_STORAGE_KEY);
  } catch {
    // Not critical: the choice just won't be remembered.
  }
}

export class ListenController {
  readonly state: Store<ListenState>;
  /** Live readings (~30/s). Separate store so only the meters re-render. */
  readonly live = new Store<SessionSnapshot | null>(null);

  private microphone: MicrophoneHandle | null = null;
  private worker: Worker | null = null;
  private noteSequence = 0;
  private startToken = 0;

  constructor(defaults: { sensitivityDb: number; a4Hz: number }) {
    this.state = new Store<ListenState>({
      status: "idle",
      errorCode: null,
      pausedReason: null,
      devices: [],
      selectedDeviceId: null,
      activeDeviceLabel: null,
      sampleRate: null,
      lowQualityInput: false,
      sensitivityDb: defaults.sensitivityDb,
      a4Hz: defaults.a4Hz,
      lastNote: null,
    });
  }

  get analyser(): AnalyserNode | null {
    return this.microphone?.analyser ?? null;
  }

  /** Call once after mounting: restores the device choice and wires browser events. Returns a cleanup function. */
  attach(): () => void {
    this.state.update({ selectedDeviceId: readStoredDevice() });
    void this.refreshDevices();
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && this.isActive()) void this.pause("hidden");
    };
    const onPageHide = () => void this.stop();
    const onDeviceChange = () => void this.refreshDevices();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
      void this.dispose();
    };
  }

  private isActive(): boolean {
    const { status } = this.state.get();
    return status === "listening" || status === "starting";
  }

  /** Must be called from a click/tap handler. */
  async start(): Promise<void> {
    if (this.isActive()) return;
    const token = ++this.startToken;
    this.state.update({ status: "starting", errorCode: null, pausedReason: null });
    try {
      // startMicrophone creates the AudioContext synchronously: keep this the first await.
      const microphone = await startMicrophone(this.state.get().selectedDeviceId, {
        onDeviceLost: () => void this.fail("device-lost"),
        onInterrupted: () => {
          if (this.state.get().status === "listening") this.state.update({ status: "paused", pausedReason: "interrupted" });
        },
      });
      if (token !== this.startToken) {
        await microphone.stop(); // stop() was pressed while we were starting
        return;
      }
      this.microphone = microphone;
      const worker = this.ensureWorker();
      const { sensitivityDb, a4Hz } = this.state.get();
      worker.postMessage({ type: "start", sampleRate: microphone.sampleRate, options: { sensitivityDb, a4Hz }, audioPort: microphone.audioPort }, [
        microphone.audioPort,
      ]);
      this.state.update({
        status: "listening",
        activeDeviceLabel: microphone.deviceLabel,
        sampleRate: microphone.sampleRate,
        lowQualityInput: microphone.lowQualityInput,
      });
      // Device labels become available once permission has been granted.
      void this.refreshDevices();
    } catch (error) {
      if (token !== this.startToken) return;
      const code = error instanceof MicrophoneError ? error.code : "audio-start-failed";
      if (!(error instanceof MicrophoneError)) console.error("[listen] start failed", error);
      await this.releaseMicrophone();
      this.state.update({ status: "error", errorCode: code });
    }
  }

  /** Stops listening and releases the microphone. */
  async stop(): Promise<void> {
    this.startToken++;
    await this.releaseMicrophone();
    this.state.update({ status: "idle", pausedReason: null });
  }

  /** After an iOS interruption: resume inside the user's tap. */
  async resume(): Promise<void> {
    const microphone = this.microphone;
    if (this.state.get().pausedReason === "interrupted" && microphone) {
      try {
        await microphone.context.resume();
        if (microphone.context.state === "running") {
          this.state.update({ status: "listening", pausedReason: null });
          return;
        }
      } catch {
        // fall through to a clean restart
      }
    }
    await this.releaseMicrophone();
    await this.start();
  }

  setSensitivity(sensitivityDb: number): void {
    this.state.update({ sensitivityDb });
    this.worker?.postMessage({ type: "set-sensitivity", sensitivityDb });
  }

  setA4(a4Hz: number): void {
    this.state.update({ a4Hz });
    this.worker?.postMessage({ type: "set-a4", a4Hz });
  }

  /** Changing the input while listening restarts on the new device (call from the change handler). */
  async selectDevice(deviceId: string | null): Promise<void> {
    storeDevice(deviceId);
    this.state.update({ selectedDeviceId: deviceId });
    if (this.isActive()) {
      await this.releaseMicrophone();
      this.state.update({ status: "idle" });
      await this.start();
    }
  }

  private async pause(reason: PausedReason): Promise<void> {
    this.startToken++;
    await this.releaseMicrophone();
    this.state.update({ status: "paused", pausedReason: reason });
  }

  private async fail(code: ListenErrorCode): Promise<void> {
    this.startToken++;
    await this.releaseMicrophone();
    this.state.update({ status: "error", errorCode: code });
    void this.refreshDevices();
  }

  private async releaseMicrophone(): Promise<void> {
    const microphone = this.microphone;
    this.microphone = null;
    this.worker?.postMessage({ type: "stop" });
    this.live.set(null);
    if (microphone) await microphone.stop();
  }

  private async refreshDevices(): Promise<void> {
    try {
      const devices = await listInputDevices();
      const { selectedDeviceId } = this.state.get();
      // Forget a remembered device that no longer exists.
      const stillThere = !selectedDeviceId || devices.some((d) => d.deviceId === selectedDeviceId);
      this.state.update({ devices, selectedDeviceId: stillThere ? selectedDeviceId : null });
    } catch {
      this.state.update({ devices: [] });
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = createAnalysisWorker();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onWorkerMessage(event.data);
    worker.onerror = (event) => {
      console.error("[listen] analysis worker failed", event.message);
      this.worker = null;
      void this.fail("engine-failed");
    };
    this.worker = worker;
    return worker;
  }

  private onWorkerMessage(message: WorkerResponse): void {
    switch (message.type) {
      case "reading":
        if (this.state.get().status === "listening") this.live.set(message.snapshot);
        break;
      case "events":
        for (const event of message.events) {
          if (event.type === "note") {
            this.state.update({
              lastNote: { reading: event.reading, warnings: event.warnings, durationMs: event.durationMs, sequence: ++this.noteSequence },
            });
          }
        }
        break;
      case "error":
        console.error("[listen] analysis error", message.message);
        break;
      default:
        break;
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.worker?.terminate();
    this.worker = null;
  }
}
