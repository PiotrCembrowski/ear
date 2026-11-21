/**
 * SYNTHETIC test signals: for tests and the calibration script ONLY.
 * They are never stored or presented as real instrument recordings.
 *
 * All randomness comes from a seeded generator, so every run is reproducible.
 */
import { midiToHz } from "../../src/lib/audio-engine/notes";

/** Mulberry32: tiny, fast, seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seconds(duration: number, sampleRate: number): number {
  return Math.round(duration * sampleRate);
}

export function sine(hz: number, duration: number, sampleRate: number, amplitude = 0.5, phase = 0): Float32Array {
  const out = new Float32Array(seconds(duration, sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin(2 * Math.PI * hz * (i / sampleRate) + phase);
  return out;
}

export function silence(duration: number, sampleRate: number): Float32Array {
  return new Float32Array(seconds(duration, sampleRate));
}

export function whiteNoise(duration: number, sampleRate: number, amplitude = 0.3, seed = 1): Float32Array {
  const random = seededRandom(seed);
  const out = new Float32Array(seconds(duration, sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * (random() * 2 - 1);
  return out;
}

export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Adds `b` into `a` (same length or shorter), returning a new array. */
export function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = a.slice();
  for (let i = 0; i < Math.min(a.length, b.length); i++) out[i]! += b[i]!;
  return out;
}

export function gain(signal: Float32Array, factor: number): Float32Array {
  return signal.map((v) => v * factor);
}

export type ToneOptions = {
  /** Relative amplitude of harmonics 1, 2, 3, … */
  harmonics: number[];
  /** Exponential decay time constant in seconds (Infinity = sustained). */
  decaySeconds?: number;
  attackSeconds?: number;
  /** Piano-like stretch: harmonic k sits at k·f0·sqrt(1 + B·k²). */
  inharmonicity?: number;
  amplitude?: number;
  /** Small random-walk pitch wobble in cents (vibrato-ish), seeded. */
  wobbleCents?: number;
  seed?: number;
};

/** Additive-synthesis tone with an attack/decay envelope. */
export function harmonicTone(f0: number, duration: number, sampleRate: number, options: ToneOptions): Float32Array {
  const { harmonics, decaySeconds = Infinity, attackSeconds = 0.005, inharmonicity = 0, amplitude = 0.5, wobbleCents = 0, seed = 7 } = options;
  const random = seededRandom(seed);
  const out = new Float32Array(seconds(duration, sampleRate));
  const total = harmonics.reduce((s, h) => s + Math.abs(h), 0) || 1;
  const phases = harmonics.map(() => random() * 2 * Math.PI);
  let wobble = 0;
  const phaseAcc = harmonics.map(() => 0);
  for (let i = 0; i < out.length; i++) {
    const t = i / sampleRate;
    if (wobbleCents > 0 && i % 64 === 0) wobble = Math.max(-wobbleCents, Math.min(wobbleCents, wobble + (random() - 0.5) * wobbleCents * 0.2));
    const f = f0 * 2 ** (wobble / 1200);
    const envelope = Math.min(1, t / attackSeconds) * (Number.isFinite(decaySeconds) ? Math.exp(-t / decaySeconds) : 1);
    let value = 0;
    for (let k = 0; k < harmonics.length; k++) {
      const n = k + 1;
      const fk = n * f * Math.sqrt(1 + inharmonicity * n * n);
      if (fk >= sampleRate / 2) continue;
      phaseAcc[k]! += (2 * Math.PI * fk) / sampleRate;
      // Higher harmonics decay faster, as on real strings.
      const harmonicDecay = Number.isFinite(decaySeconds) ? Math.exp((-t * (n - 1) * 0.6) / decaySeconds) : 1;
      value += harmonics[k]! * harmonicDecay * Math.sin(phaseAcc[k]! + phases[k]!);
    }
    out[i] = (amplitude * envelope * value) / total;
  }
  return out;
}

/** A piano-ish synthetic note (bright attack, inharmonic partials, decay). Labelled synthetic. */
export function syntheticPianoNote(midi: number, duration: number, sampleRate: number, velocity = 0.6, seed = 11): Float32Array {
  return harmonicTone(midiToHz(midi), duration, sampleRate, {
    harmonics: [1, 0.7, 0.45, 0.3, 0.2, 0.14, 0.1, 0.07, 0.05, 0.03],
    decaySeconds: 1.2,
    attackSeconds: 0.004,
    inharmonicity: 0.0004,
    amplitude: velocity,
    seed,
  });
}

/** A mellow, flute/ocarina-like synthetic tone (few harmonics, sustained). */
export function syntheticFluteNote(midi: number, duration: number, sampleRate: number, seed = 5): Float32Array {
  return harmonicTone(midiToHz(midi), duration, sampleRate, {
    harmonics: [1, 0.25, 0.08, 0.03],
    attackSeconds: 0.06,
    amplitude: 0.5,
    wobbleCents: 4,
    seed,
  });
}

/** Karplus–Strong plucked string (guitar-like), seeded. */
export function syntheticPluck(midi: number, duration: number, sampleRate: number, seed = 3): Float32Array {
  const random = seededRandom(seed);
  const period = Math.round(sampleRate / midiToHz(midi));
  const ring = new Float32Array(period).map(() => random() * 2 - 1);
  const out = new Float32Array(seconds(duration, sampleRate));
  for (let i = 0; i < out.length; i++) {
    const j = i % period;
    const next = (j + 1) % period;
    out[i] = ring[j]! * 0.5;
    ring[j] = 0.996 * 0.5 * (ring[j]! + ring[next]!);
  }
  return out;
}

/** A short noisy percussive hit (drum-like), seeded. */
export function syntheticHit(duration: number, sampleRate: number, seed = 9, decaySeconds = 0.08): Float32Array {
  const noise = whiteNoise(duration, sampleRate, 0.8, seed);
  return noise.map((v, i) => v * Math.exp(-i / sampleRate / decaySeconds));
}

/**
 * Piano-ish velocity layers: like real pianos, harder strikes are BRIGHTER
 * (stronger upper harmonics), not just louder. Overall level differs too,
 * but timbre comparison ignores level, so brightness is what tells them apart.
 */
export function syntheticPianoLayer(midi: number, duration: number, sampleRate: number, layer: "soft" | "loud", seed = 11): Float32Array {
  const rolloff = layer === "loud" ? 0.8 : 0.35; // amplitude ratio between neighbouring harmonics
  return harmonicTone(midiToHz(midi), duration, sampleRate, {
    harmonics: Array.from({ length: 10 }, (_, k) => rolloff ** k),
    decaySeconds: 1.2,
    attackSeconds: 0.004,
    inharmonicity: 0.0004,
    amplitude: layer === "loud" ? 0.8 : 0.2,
    seed,
  });
}
