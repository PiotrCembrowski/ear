/**
 * Microphone capture with the Web Audio API.
 *
 * Signal graph (built in startMicrophone):
 *
 *   getUserMedia stream ─▶ MediaStreamSource ─┬─▶ AnalyserNode   (visuals on the UI thread)
 *                                             └─▶ AudioWorkletNode "capture" ─▶ Gain(0) ─▶ destination
 *
 * The silent Gain(0) → destination connection keeps the worklet running in
 * every browser (some only process nodes that lead to an output) without
 * playing anything back, so there is no feedback.
 *
 * Choices that matter for musical analysis:
 *  - echoCancellation, noiseSuppression and autoGainControl are OFF: they
 *    are built for voice calls and distort or duck sustained musical tones.
 *  - The AudioContext uses the device's native sample rate (never forced):
 *    Firefox refuses to connect a mic to a context with a different rate, and
 *    the engine resamples anyway.
 *  - The AudioContext is created synchronously inside the click handler
 *    (before any await), which iOS Safari requires to allow audio.
 */
import { CAPTURE_PROCESSOR_NAME, CAPTURE_WORKLET_URL, workletBatchSize } from "./constants";

export type MicrophoneErrorCode =
  | "insecure-context"
  | "unsupported"
  | "permission-denied"
  | "no-microphone"
  | "device-in-use"
  | "device-lost"
  | "audio-start-failed";

export class MicrophoneError extends Error {
  constructor(
    readonly code: MicrophoneErrorCode,
    cause?: unknown,
  ) {
    super(code, { cause });
    this.name = "MicrophoneError";
  }
}

/** Checks what can be checked before asking for permission. */
export function checkMicrophoneSupport(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  hasAudioContext: boolean;
  hasAudioWorklet: boolean;
  hasWorker: boolean;
}): MicrophoneErrorCode | null {
  if (!env.isSecureContext) return "insecure-context";
  if (!env.hasGetUserMedia || !env.hasAudioContext || !env.hasAudioWorklet || !env.hasWorker) return "unsupported";
  return null;
}

export function browserSupport(): MicrophoneErrorCode | null {
  if (typeof window === "undefined") return "unsupported";
  return checkMicrophoneSupport({
    isSecureContext: window.isSecureContext,
    hasGetUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
    hasAudioContext: typeof window.AudioContext === "function",
    hasAudioWorklet: typeof window.AudioWorkletNode === "function",
    hasWorker: typeof window.Worker === "function",
  });
}

/** Maps getUserMedia / Web Audio failures to the cases the UI explains. */
export function classifyMicrophoneError(error: unknown): MicrophoneErrorCode {
  if (error instanceof MicrophoneError) return error.code;
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "permission-denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "no-microphone";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "device-in-use";
    default:
      return "audio-start-failed";
  }
}

export type InputDevice = { deviceId: string; label: string };

/** Audio inputs. Labels are empty until the user has granted microphone access once. */
export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput" && d.deviceId !== "")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

export type MicrophoneHandle = {
  readonly context: AudioContext;
  readonly analyser: AnalyserNode;
  /** Port that delivers audio batches; hand it to the analysis worker. */
  readonly audioPort: MessagePort;
  readonly sampleRate: number;
  readonly deviceId: string | null;
  readonly deviceLabel: string;
  /** True for low-rate inputs (e.g. Bluetooth headsets in call mode): high notes and timbre suffer. */
  readonly lowQualityInput: boolean;
  /** Stops every track (the browser's mic indicator turns off) and closes the audio graph. Safe to call twice. */
  stop(): Promise<void>;
};

export type MicrophoneCallbacks = {
  /** The device was unplugged or disabled while listening. */
  onDeviceLost(): void;
  /** The AudioContext was suspended or interrupted (iOS calls, screen lock…). */
  onInterrupted(): void;
};

/**
 * Starts the microphone. Call it DIRECTLY from a click/tap handler: the
 * AudioContext is created before the first await so iOS accepts it.
 */
export async function startMicrophone(deviceId: string | null, callbacks: MicrophoneCallbacks): Promise<MicrophoneHandle> {
  const unsupported = browserSupport();
  if (unsupported) throw new MicrophoneError(unsupported);

  // Created inside the user gesture, before any await (iOS requirement).
  const context = new AudioContext({ latencyHint: "interactive" });
  void context.resume().catch(() => undefined);

  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: 1 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    await context.audioWorklet.addModule(CAPTURE_WORKLET_URL);

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.6;
    const capture = new AudioWorkletNode(context, CAPTURE_PROCESSOR_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCountMode: "max",
      processorOptions: { batchSize: workletBatchSize(context.sampleRate) },
    });
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(analyser);
    source.connect(capture);
    capture.connect(mute).connect(context.destination);

    // Audio goes worklet → worker directly on this channel.
    const channel = new MessageChannel();
    capture.port.postMessage({ type: "connect", port: channel.port1 }, [channel.port1]);

    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings() ?? {};
    const onEnded = () => callbacks.onDeviceLost();
    track?.addEventListener("ended", onEnded);
    const onStateChange = () => {
      // "interrupted" is Safari-specific; both mean audio has stopped flowing.
      if ((context.state as string) === "suspended" || (context.state as string) === "interrupted") callbacks.onInterrupted();
    };
    context.addEventListener("statechange", onStateChange);

    let stopped = false;
    const activeStream = stream;
    return {
      context,
      analyser,
      audioPort: channel.port2,
      sampleRate: context.sampleRate,
      deviceId: settings.deviceId ?? deviceId,
      deviceLabel: track?.label || "Microphone",
      lowQualityInput: (settings.sampleRate ?? context.sampleRate) <= 16_000,
      async stop() {
        if (stopped) return;
        stopped = true;
        track?.removeEventListener("ended", onEnded);
        context.removeEventListener("statechange", onStateChange);
        capture.port.postMessage({ type: "stop" });
        for (const t of activeStream.getTracks()) t.stop();
        source.disconnect();
        capture.disconnect();
        await context.close().catch(() => undefined);
      },
    };
  } catch (error) {
    for (const t of stream?.getTracks() ?? []) t.stop();
    await context.close().catch(() => undefined);
    throw new MicrophoneError(classifyMicrophoneError(error), error);
  }
}
