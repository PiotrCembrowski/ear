/**
 * Orchestrates one Listen screen: microphone ↔ analysis worker ↔ UI stores.
 * Plain TypeScript (no React), so the lifecycle rules live in one place:
 *
 *  - start() must be called from a click/tap (iOS audio rules).
 *  - stop() stops every microphone track, so the browser's mic indicator turns off.
 *  - The tab going to the background stops listening (privacy, and iOS would
 *    suspend audio anyway); so do pagehide and leaving the page.
 *  - An unplugged device or an interrupted AudioContext is reported clearly.
 *
 * Modes (identify / compare / closest) only change what the worker does with
 * each sound; switching never restarts the microphone. Results are saved to
 * history automatically for signed-in users (unless they turned it off);
 * only result summaries are sent, never audio.
 */
import type { ClosestResult } from "@/lib/audio-engine/closest";
import type { ListeningMode, SessionSnapshot } from "@/lib/audio-engine/listening-session";
import type { NoteReading } from "@/lib/audio-engine/strategies/pitch";
import type { ComparisonResult, QualityWarning } from "@/lib/audio-engine/types";
import { fetchInstrumentFeatures, fetchReferenceFeatures, FeaturesError } from "@/lib/audio-browser/features-client";
import type { InstrumentFeaturesResponse, ReferenceSummary } from "@/lib/audio-browser/reference-data";
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
import type { WorkerRequest, WorkerResponse } from "@/lib/audio-browser/protocol";
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

export type ListenMode = "identify" | "compare" | "closest";

export type CompareSetup =
  | { status: "empty" }
  | { status: "loading"; referenceId: string }
  | { status: "ready"; referenceId: string; reference: ReferenceSummary; strategyId: string }
  | { status: "error"; referenceId: string; message: string };

export type CandidateLabel = { name: string; noteName: string; velocity: number | null; variant: string; isSynthetic: boolean };

export type ClosestSetup =
  | { status: "empty" }
  | { status: "loading"; instrumentId: string; variant: string | null }
  | {
      status: "ready";
      instrumentId: string;
      instrumentName: string;
      variant: string | null;
      variants: string[];
      count: number;
      labels: ReadonlyMap<string, CandidateLabel>;
    }
  | { status: "error"; instrumentId: string; variant: string | null; message: string };

export type LastResult =
  | { kind: "comparison"; result: ComparisonResult; reference: ReferenceSummary; finishedEarly: boolean; sequence: number }
  | {
      kind: "closest";
      result: ClosestResult;
      instrumentId: string;
      instrumentName: string;
      variant: string | null;
      labels: ReadonlyMap<string, CandidateLabel>;
      sequence: number;
    };

export type SaveState =
  | { status: "idle" }
  | { status: "saving"; sequence: number }
  | { status: "saved"; sequence: number; id: string }
  | { status: "skipped"; sequence: number; message: string }
  | { status: "error"; sequence: number; message: string };

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
  mode: ListenMode;
  compare: CompareSetup;
  closest: ClosestSetup;
  lastResult: LastResult | null;
  save: SaveState;
};

export type ListenDefaults = {
  sensitivityDb: number;
  a4Hz: number;
  /** Signed-in users can compare and save; identify works for everyone. */
  signedIn: boolean;
  saveHistory: boolean;
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
  private readonly signedIn: boolean;
  private readonly saveHistory: boolean;
  /** Features for the worker, kept here so a (re)started worker gets the current mode. */
  private compareMode: Extract<ListeningMode, { mode: "compare" }> | null = null;
  private closestMode: Extract<ListeningMode, { mode: "closest" }> | null = null;

  constructor(defaults: ListenDefaults) {
    this.signedIn = defaults.signedIn;
    this.saveHistory = defaults.saveHistory;
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
      mode: "identify",
      compare: { status: "empty" },
      closest: { status: "empty" },
      lastResult: null,
      save: { status: "idle" },
    });
  }

  // -------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------

  /** What the worker should do with each sound, given the selected mode and loaded features. */
  private workerMode(): ListeningMode {
    const { mode } = this.state.get();
    if (mode === "compare" && this.compareMode) return this.compareMode;
    if (mode === "closest" && this.closestMode) return this.closestMode;
    return { mode: "identify" };
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker?.postMessage(message, transfer);
  }

  private syncWorkerMode(): void {
    this.post({ type: "set-mode", mode: this.workerMode() });
  }

  selectMode(mode: ListenMode): void {
    if (this.state.get().mode === mode) return;
    this.state.update({ mode, lastResult: null, save: { status: "idle" } });
    this.syncWorkerMode();
  }

  /** Loads a reference's features (cached) and makes it the compare target. */
  async loadReference(referenceId: string): Promise<void> {
    this.state.update({ compare: { status: "loading", referenceId } });
    try {
      const data = await fetchReferenceFeatures(referenceId);
      if (this.state.get().compare.status !== "loading") return;
      this.compareMode = { mode: "compare", reference: data.features };
      this.state.update({ compare: { status: "ready", referenceId, reference: data.reference, strategyId: data.strategyId }, lastResult: null });
      this.syncWorkerMode();
    } catch (error) {
      this.compareMode = null;
      this.state.update({ compare: { status: "error", referenceId, message: error instanceof FeaturesError ? error.message : "Couldn't load the reference." } });
      this.syncWorkerMode();
    }
  }

  /** Loads all samples of an instrument (optionally one variant) for closest match. */
  async loadInstrument(instrumentId: string, variant: string | null): Promise<void> {
    this.state.update({ closest: { status: "loading", instrumentId, variant } });
    try {
      const data: InstrumentFeaturesResponse = await fetchInstrumentFeatures(instrumentId, variant);
      this.closestMode = {
        mode: "closest",
        primary: data.primary,
        candidates: data.candidates.map((c) => ({ id: c.referenceId, pitch: c.pitch, timbre: c.timbre })),
      };
      const labels = new Map(data.candidates.map((c) => [c.referenceId, { name: c.name, noteName: c.noteName, velocity: c.velocity, variant: c.variant, isSynthetic: c.isSynthetic }]));
      this.state.update({
        closest: {
          status: "ready",
          instrumentId,
          instrumentName: data.instrument.name,
          variant: data.variant,
          variants: data.variants,
          count: data.candidates.length,
          labels,
        },
        lastResult: null,
      });
      this.syncWorkerMode();
    } catch (error) {
      this.closestMode = null;
      this.state.update({
        closest: { status: "error", instrumentId, variant, message: error instanceof FeaturesError ? error.message : "Couldn't load the instrument's samples." },
      });
      this.syncWorkerMode();
    }
  }

  /** "Try again": clears the result and makes sure we're listening (call from a click). */
  async tryAgain(): Promise<void> {
    this.state.update({ lastResult: null, save: { status: "idle" } });
    if (!this.isActive()) await this.start();
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  /** Saves the last compare/closest result explicitly (e.g. when automatic saving is off). */
  async saveLastResult(): Promise<void> {
    const result = this.state.get().lastResult;
    if (result) await this.saveResult(result, "manual");
  }

  /** "Save this note" in identify mode. */
  async saveLastNote(): Promise<void> {
    const note = this.state.get().lastNote;
    if (!note?.reading) return;
    const { reading } = note;
    await this.submit(note.sequence, {
      mode: "identify",
      trigger: "manual",
      result: {
        name: reading.name,
        midi: reading.midi,
        hz: reading.hz,
        cents: reading.cents,
        confidence: reading.confidence,
        warnings: note.warnings,
        durationMs: note.durationMs,
      },
    });
  }

  private async saveResult(result: LastResult, trigger: "auto" | "manual"): Promise<void> {
    if (result.kind === "comparison") {
      await this.submit(result.sequence, { mode: "compare", trigger, referenceId: result.reference.id, result: result.result });
    } else {
      await this.submit(result.sequence, { mode: "closest", trigger, instrumentId: result.instrumentId, variant: result.variant, result: result.result });
    }
  }

  /** Sends a result SUMMARY (numbers and labels, never audio) to the history API. */
  private async submit(sequence: number, payload: unknown): Promise<void> {
    if (!this.signedIn) {
      this.state.update({ save: { status: "skipped", sequence, message: "Sign in to keep a history of your results." } });
      return;
    }
    this.state.update({ save: { status: "saving", sequence } });
    try {
      const response = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { saved?: boolean; id?: string; reason?: string; error?: string };
      if (response.ok && body.saved && body.id) this.state.update({ save: { status: "saved", sequence, id: body.id } });
      else if (response.ok && body.reason === "history-off") {
        this.state.update({ save: { status: "skipped", sequence, message: "Not saved: saving to history is turned off in Settings." } });
      } else this.state.update({ save: { status: "error", sequence, message: body.error ?? "Couldn't save to history." } });
    } catch {
      this.state.update({ save: { status: "error", sequence, message: "Couldn't reach the server to save this result." } });
    }
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
      this.ensureWorker();
      const { sensitivityDb, a4Hz } = this.state.get();
      this.post(
        { type: "start", sampleRate: microphone.sampleRate, options: { sensitivityDb, a4Hz }, mode: this.workerMode(), audioPort: microphone.audioPort },
        [microphone.audioPort],
      );
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
    this.post({ type: "set-sensitivity", sensitivityDb });
  }

  setA4(a4Hz: number): void {
    this.state.update({ a4Hz });
    this.post({ type: "set-a4", a4Hz });
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
    this.post({ type: "stop" });
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
          const { mode, compare, closest } = this.state.get();
          if (event.type === "note" && mode === "identify") {
            this.state.update({
              lastNote: { reading: event.reading, warnings: event.warnings, durationMs: event.durationMs, sequence: ++this.noteSequence },
              save: { status: "idle" },
            });
          } else if (event.type === "comparison" && mode === "compare" && compare.status === "ready") {
            this.publishResult({ kind: "comparison", result: event.result, reference: compare.reference, finishedEarly: event.finishedEarly, sequence: ++this.noteSequence });
          } else if (event.type === "closest" && mode === "closest" && closest.status === "ready") {
            this.publishResult({
              kind: "closest",
              result: event.result,
              instrumentId: closest.instrumentId,
              instrumentName: closest.instrumentName,
              variant: closest.variant,
              labels: closest.labels,
              sequence: ++this.noteSequence,
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

  private publishResult(result: LastResult): void {
    this.state.update({ lastResult: result, save: { status: "idle" } });
    if (this.signedIn && this.saveHistory) void this.saveResult(result, "auto");
    else if (this.signedIn) this.state.update({ save: { status: "skipped", sequence: result.sequence, message: "Not saved: saving to history is off." } });
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.worker?.terminate();
    this.worker = null;
  }
}
