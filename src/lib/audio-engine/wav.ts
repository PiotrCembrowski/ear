/**
 * Minimal WAV (RIFF/WAVE) reader and writer. Used ONLY for reference sounds:
 * the admin importer writes normalized WAVs, and the server reads them back to
 * extract features. User audio is never encoded or decoded here.
 *
 * Supported input: PCM integer 8/16/24/32-bit, IEEE float 32/64-bit, and the
 * WAVE_FORMAT_EXTENSIBLE wrapper around those. Multi-channel audio is
 * downmixed to mono by averaging channels.
 */
import type { AudioClip } from "./types";

const FORMAT_PCM = 1;
const FORMAT_IEEE_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

export class WavFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WavFormatError";
  }
}

export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  format: "pcm" | "float";
  frameCount: number;
  durationMs: number;
};

function readFourCC(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
}

/** Decodes a WAV file to a mono clip. Throws WavFormatError for anything unsupported or damaged. */
export function decodeWav(buffer: ArrayBuffer | Uint8Array): AudioClip & { info: WavInfo } {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 12 || readFourCC(view, 0) !== "RIFF" || readFourCC(view, 8) !== "WAVE") {
    throw new WavFormatError("Not a WAV file (missing RIFF/WAVE header).");
  }

  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number; blockAlign: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  // Walk the chunks. Each chunk: 4-byte id, 4-byte little-endian size, payload
  // padded to an even length. Unknown chunks (LIST, cue, smpl, …) are skipped.
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readFourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > view.byteLength) throw new WavFormatError("Damaged WAV format chunk.");
      let audioFormat = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const blockAlign = view.getUint16(body + 12, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      if (audioFormat === FORMAT_EXTENSIBLE) {
        // The real format code is the first 2 bytes of the SubFormat GUID (offset 24 in the chunk).
        if (size < 40 || body + 26 > view.byteLength) throw new WavFormatError("Damaged WAV extensible format chunk.");
        audioFormat = view.getUint16(body + 24, true);
      }
      fmt = { audioFormat, channels, sampleRate, bitsPerSample, blockAlign };
    } else if (id === "data") {
      dataOffset = body;
      // Some writers leave the size as 0 or too large when streaming; clamp to the file.
      dataLength = Math.min(size, view.byteLength - body);
      if (fmt) break;
    }
    offset = body + size + (size % 2);
  }

  if (!fmt) throw new WavFormatError("WAV file has no format chunk.");
  if (dataOffset < 0) throw new WavFormatError("WAV file has no audio data.");
  const { audioFormat, channels, sampleRate, bitsPerSample } = fmt;
  if (channels < 1 || channels > 32) throw new WavFormatError(`Unsupported channel count: ${channels}.`);
  if (sampleRate < 3000 || sampleRate > 384_000) throw new WavFormatError(`Unsupported sample rate: ${sampleRate} Hz.`);

  const isFloat = audioFormat === FORMAT_IEEE_FLOAT;
  if (!(audioFormat === FORMAT_PCM || isFloat)) {
    throw new WavFormatError(`Unsupported WAV encoding (format code ${audioFormat}); use PCM or float.`);
  }
  if (isFloat ? ![32, 64].includes(bitsPerSample) : ![8, 16, 24, 32].includes(bitsPerSample)) {
    throw new WavFormatError(`Unsupported bit depth: ${bitsPerSample}-bit ${isFloat ? "float" : "PCM"}.`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = bytesPerSample * channels;
  const frameCount = Math.floor(dataLength / frameBytes);
  const samples = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      const p = dataOffset + frame * frameBytes + channel * bytesPerSample;
      let value: number;
      if (isFloat) {
        value = bitsPerSample === 32 ? view.getFloat32(p, true) : view.getFloat64(p, true);
      } else if (bitsPerSample === 8) {
        value = (view.getUint8(p) - 128) / 128; // 8-bit WAV is unsigned
      } else if (bitsPerSample === 16) {
        value = view.getInt16(p, true) / 32768;
      } else if (bitsPerSample === 24) {
        const raw = view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getInt8(p + 2) << 16);
        value = raw / 8388608;
      } else {
        value = view.getInt32(p, true) / 2147483648;
      }
      sum += value;
    }
    samples[frame] = sum / channels;
  }

  return {
    samples,
    sampleRate,
    info: {
      sampleRate,
      channels,
      bitsPerSample,
      format: isFloat ? "float" : "pcm",
      frameCount,
      durationMs: (frameCount / sampleRate) * 1000,
    },
  };
}

/**
 * Encodes a mono clip as 16-bit PCM WAV. Samples are clipped to [-1, 1] and
 * rounded to the nearest 16-bit step (no dither; references are clean
 * recordings and 16-bit noise is ~ -96 dBFS).
 */
export function encodeWav16(clip: AudioClip): Uint8Array {
  const { samples, sampleRate } = clip;
  const dataBytes = samples.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const writeFourCC = (offset: number, text: string) => {
    for (let i = 0; i < 4; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeFourCC(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeFourCC(8, "WAVE");
  writeFourCC(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeFourCC(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    // Same scale (×32768) as decodeWav uses (÷32768), so a round trip is
    // accurate to half a step; +1.0 is clamped to the largest 16-bit value.
    const value = Math.round(samples[i]! * 32768);
    view.setInt16(44 + i * 2, value > 32767 ? 32767 : value < -32768 ? -32768 : value, true);
  }
  return out;
}
