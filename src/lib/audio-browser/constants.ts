/** Browser-side audio constants. */

/** Must match registerProcessor() in worklets/capture-processor.ts (checked by its test). */
export const CAPTURE_PROCESSOR_NAME = "soundmatch-capture";

/** Compiled worklet, served from public/ (see `npm run build:worklets`). */
export const CAPTURE_WORKLET_URL = "/worklets/capture-processor.js";

/** Target batch length sent from the worklet to the worker (~21 ms; a multiple of the 128-sample render quantum). */
export function workletBatchSize(sampleRate: number): number {
  return Math.max(128, Math.round((sampleRate * 0.021) / 128) * 128);
}

/** How often the worker sends live readings to the UI (ms). ~30 per second is smooth without wasting work. */
export const READING_INTERVAL_MS = 33;

/** localStorage key for the preferred input device (device ids are per browser, so this is not synced to the profile). */
export const INPUT_DEVICE_STORAGE_KEY = "soundmatch:input-device";
