/**
 * Browser-side decoding of reference files for the admin importer. The
 * browser's own decoders handle WAV, MP3, AAC/M4A, OGG/Opus, FLAC and (Safari
 * only) AIFF, with no native code on our side. User microphone audio never
 * passes through here.
 */
import { prepareReferenceAudio, type PreparedReference } from "@/lib/audio-engine/prepare-reference";
import { encodeWav16 } from "@/lib/audio-engine/wav";

/** References are stored at 44.1 kHz (good preview quality, ≤ 2.6 MB for 30 s). */
export const STORED_SAMPLE_RATE = 44_100;

export class DecodeError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "DecodeError";
  }
}

/**
 * Decodes a file with Web Audio. An OfflineAudioContext at 44.1 kHz makes
 * the browser resample while decoding.
 */
export async function decodeAudioFile(file: Blob): Promise<AudioBuffer> {
  const data = await file.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, STORED_SAMPLE_RATE);
  try {
    return await context.decodeAudioData(data);
  } catch (error) {
    throw new DecodeError("This browser can't decode the file. It may be damaged, or in a format this browser doesn't support (AIFF only works in Safari; convert it to WAV or FLAC).", error);
  }
}

export type NormalizedReference = Omit<PreparedReference, "clip"> & { wav: Uint8Array; sampleRate: number };

/** Decodes, downmixes, trims, caps at 30 s and encodes as 16-bit mono WAV. */
export async function normalizeReferenceFile(file: Blob): Promise<NormalizedReference> {
  const buffer = await decodeAudioFile(file);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const prepared = prepareReferenceAudio(channels, buffer.sampleRate);
  if (prepared.clip.samples.length === 0) throw new DecodeError("The file contains only silence.");
  const { clip, ...info } = prepared;
  return { ...info, sampleRate: clip.sampleRate, wav: encodeWav16(clip) };
}
