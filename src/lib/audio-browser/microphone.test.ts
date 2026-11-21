import { describe, expect, it } from "vitest";
import { checkMicrophoneSupport, classifyMicrophoneError, MicrophoneError } from "./microphone";
import { workletBatchSize } from "./constants";

const supported = { isSecureContext: true, hasGetUserMedia: true, hasAudioContext: true, hasAudioWorklet: true, hasWorker: true };

describe("microphone support and errors", () => {
  it("requires a secure context first, then the needed APIs", () => {
    expect(checkMicrophoneSupport(supported)).toBeNull();
    expect(checkMicrophoneSupport({ ...supported, isSecureContext: false, hasGetUserMedia: false })).toBe("insecure-context");
    expect(checkMicrophoneSupport({ ...supported, hasAudioWorklet: false })).toBe("unsupported");
    expect(checkMicrophoneSupport({ ...supported, hasGetUserMedia: false })).toBe("unsupported");
  });

  it.each([
    ["NotAllowedError", "permission-denied"],
    ["SecurityError", "permission-denied"],
    ["NotFoundError", "no-microphone"],
    ["OverconstrainedError", "no-microphone"],
    ["NotReadableError", "device-in-use"],
    ["AbortError", "device-in-use"],
    ["SomethingNew", "audio-start-failed"],
  ])("maps %s to %s", (name, code) => {
    expect(classifyMicrophoneError(Object.assign(new Error("x"), { name }))).toBe(code);
  });

  it("keeps codes from MicrophoneError and handles non-errors", () => {
    expect(classifyMicrophoneError(new MicrophoneError("device-lost"))).toBe("device-lost");
    expect(classifyMicrophoneError("boom")).toBe("audio-start-failed");
  });

  it("batches ~21 ms in whole render quanta", () => {
    expect(workletBatchSize(48000)).toBe(1024);
    expect(workletBatchSize(44100)).toBe(896);
    expect(workletBatchSize(16000)).toBe(384);
    expect(workletBatchSize(8000) % 128).toBe(0);
  });
});
