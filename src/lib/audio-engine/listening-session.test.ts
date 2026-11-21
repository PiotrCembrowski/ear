import { describe, expect, it } from "vitest";
import { concat, mix, silence, sine, syntheticFluteNote, syntheticPianoLayer, syntheticPianoNote, whiteNoise } from "../../../tests/audio/synthetic";
import { ListeningSession, type SessionEvent, type SessionSnapshot } from "./listening-session";
import { pitchStrategy } from "./strategies/pitch";
import { timbreStrategy } from "./strategies/timbre";

const SR = 48000;
const BLOCK = 1024; // roughly what the AudioWorklet delivers (~21 ms at 48 kHz)

function run(session: ListeningSession, audio: Float32Array) {
  const events: SessionEvent[] = [];
  const snapshots: Array<{ ms: number; snapshot: SessionSnapshot }> = [];
  for (let offset = 0; offset < audio.length; offset += BLOCK) {
    events.push(...session.push(audio.subarray(offset, offset + BLOCK)));
    snapshots.push({ ms: ((offset + BLOCK) / SR) * 1000, snapshot: session.snapshot() });
  }
  return { events, snapshots };
}

const hiss = (seconds: number, seed = 1) => whiteNoise(seconds, SR, 0.003, seed);

describe("ListeningSession (identify mode)", () => {
  it("shows a live tuner reading while a note plays, and nothing in silence", () => {
    const audio = mix(concat(silence(0.6, SR), sine(440 * 2 ** (7 / 1200), 1, SR, 0.3), silence(0.6, SR)), hiss(2.2));
    const { snapshots } = run(new ListeningSession(SR), audio);
    const during = snapshots.filter((s) => s.ms > 900 && s.ms < 1500);
    expect(during.every((s) => s.snapshot.tuner?.note.name === "A4")).toBe(true);
    expect(during.every((s) => Math.abs(s.snapshot.tuner!.note.cents - 7) < 1)).toBe(true);
    expect(snapshots.filter((s) => s.ms > 1900).every((s) => s.snapshot.tuner === null)).toBe(true);
    expect(snapshots.filter((s) => s.ms < 550).every((s) => s.snapshot.tuner === null)).toBe(true);
  });

  it("responds within ~150 ms of a note starting", () => {
    const audio = mix(concat(silence(0.6, SR), sine(330, 0.6, SR, 0.3)), hiss(1.2));
    const { snapshots } = run(new ListeningSession(SR), audio);
    const first = snapshots.find((s) => s.snapshot.tuner?.note.name === "E4");
    expect(first!.ms - 600).toBeLessThan(150);
  });

  it("keeps the tuner running on a note longer than the 5 s event limit", () => {
    const audio = mix(concat(silence(0.5, SR), syntheticFluteNote(62, 7, SR)), hiss(7.5));
    const { snapshots } = run(new ListeningSession(SR), audio);
    const late = snapshots.filter((s) => s.ms > 6000 && s.ms < 7300);
    expect(late.every((s) => s.snapshot.tuner?.note.name === "D4")).toBe(true);
  });

  it("reports one 'note' result per sound, with name, cents and confidence", () => {
    const audio = mix(
      concat(silence(0.5, SR), syntheticPianoNote(60, 1, SR), silence(0.5, SR), syntheticPianoNote(67, 1, SR), silence(0.6, SR)),
      hiss(3.6),
    );
    const { events } = run(new ListeningSession(SR), audio);
    const notes = events.filter((e) => e.type === "note");
    expect(events.filter((e) => e.type === "sound-start")).toHaveLength(2);
    expect(notes.map((n) => n.type === "note" && n.reading?.name)).toEqual(["C4", "G4"]);
    for (const note of notes) {
      if (note.type !== "note") continue;
      expect(note.reading?.confidence.level).toBe("high");
      expect(Math.abs(note.reading!.cents)).toBeLessThan(5);
    }
  });

  it("names notes relative to the chosen A4 and can change it while running", () => {
    const session = new ListeningSession(SR, { a4Hz: 442 });
    const { snapshots } = run(session, mix(concat(silence(0.5, SR), sine(442, 0.8, SR, 0.3)), hiss(1.3)));
    expect(Math.abs(snapshots.at(-1)!.snapshot.tuner!.note.cents)).toBeLessThan(1);
    session.setA4(440);
    expect(session.snapshot().tuner!.note.cents).toBeCloseTo(7.85, 0);
  });

  it("ignores clicks, and reports 'no clear pitch' for noise bursts", () => {
    const click = whiteNoise(0.03, SR, 0.5, 3);
    const burst = whiteNoise(0.5, SR, 0.3, 4);
    const audio = mix(concat(silence(0.5, SR), click, silence(0.6, SR), burst, silence(0.6, SR)), hiss(2.23));
    const { events } = run(new ListeningSession(SR), audio);
    const notes = events.filter((e) => e.type === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type === "note" && notes[0]!.reading).toBeNull();
    expect(notes[0]!.type === "note" && notes[0]!.warnings.map((w) => w.code)).toContain("no_clear_pitch");
  });

  it("ignores the digital silence some microphones deliver while starting up", () => {
    // 0.4 s of exact zeros (mic start-up), then room hiss, then a note.
    const audio = concat(silence(0.4, SR), mix(concat(silence(1, SR), syntheticPianoNote(69, 1, SR), silence(0.6, SR)), hiss(2.6)));
    const { events } = run(new ListeningSession(SR), audio);
    const notes = events.filter((e) => e.type === "note");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.type === "note" && notes[0]!.reading?.name).toBe("A4");
  });

  it("responds to sensitivity changes", () => {
    const quietNote = mix(concat(silence(0.5, SR), sine(440, 0.8, SR, 0.006)), hiss(1.3));
    const deaf = new ListeningSession(SR, { sensitivityDb: 30 });
    expect(run(deaf, quietNote).events.filter((e) => e.type === "sound-start")).toHaveLength(0);
    const keen = new ListeningSession(SR, { sensitivityDb: 6 });
    expect(run(keen, quietNote).events.filter((e) => e.type === "sound-start")).toHaveLength(1);
  });

  it("reports calibration, level, threshold and sound-active state", () => {
    const session = new ListeningSession(SR);
    session.push(hiss(0.1));
    expect(session.snapshot().calibrating).toBe(true);
    session.push(hiss(0.3, 2));
    const idle = session.snapshot();
    expect(idle.calibrating).toBe(false);
    expect(idle.soundActive).toBe(false);
    expect(idle.noiseFloorDb).toBeGreaterThan(-70);
    expect(idle.thresholdDb).toBeCloseTo(idle.noiseFloorDb + 12, 5);
    session.push(sine(440, 0.2, SR, 0.3));
    expect(session.snapshot().soundActive).toBe(true);
    expect(session.snapshot().levelDb).toBeGreaterThan(-15);
  });

  it("flush() finishes a note that is still sounding when listening stops", () => {
    const session = new ListeningSession(SR);
    run(session, mix(concat(silence(0.5, SR), sine(523.25, 0.8, SR, 0.3)), hiss(1.3)));
    const events = session.flush();
    expect(events).toHaveLength(1);
    expect(events[0]!.type === "note" && events[0]!.reading?.name).toBe("C5");
  });
});

describe("ListeningSession (compare and closest modes)", () => {
  const refSR = 44100;
  const pianoRef = (midi: number, velocity = 0.6, seed = 11) => {
    const clip = { samples: syntheticPianoNote(midi, 1.5, refSR, velocity, seed), sampleRate: refSR };
    return { pitch: pitchStrategy.extract(clip), timbre: timbreStrategy.extract(clip) };
  };

  it("compares each sound with a pitch reference and finishes early on a ringing note", () => {
    const session = new ListeningSession(SR);
    session.setMode({ mode: "compare", reference: pianoRef(69).pitch });
    const audio = mix(concat(silence(0.5, SR), syntheticPianoNote(69, 4, SR, 0.5, 3), silence(0.6, SR)), hiss(5.1));
    const { events } = run(session, audio);
    const results = events.filter((e) => e.type === "comparison");
    expect(results).toHaveLength(1); // one result per sound, not a second one when it ends
    const comparison = results[0]!;
    if (comparison.type !== "comparison") throw new Error("unexpected");
    expect(comparison.finishedEarly).toBe(true);
    expect(comparison.durationMs).toBeLessThan(1200);
    expect(comparison.result.strategyId).toBe("pitch");
    expect(comparison.result.score).toBeGreaterThan(95);
  });

  it("scores a different note low", () => {
    const session = new ListeningSession(SR);
    session.setMode({ mode: "compare", reference: pianoRef(69).pitch });
    const { events } = run(session, mix(concat(silence(0.5, SR), syntheticPianoNote(71, 1.5, SR), silence(0.6, SR)), hiss(2.6)));
    const comparison = events.find((e) => e.type === "comparison");
    expect(comparison?.type === "comparison" && comparison.result.score).toBe(0);
  });

  it("waits for the end of the sound with a timbre reference", () => {
    const session = new ListeningSession(SR);
    const reference = timbreStrategy.extract({ samples: syntheticPianoNote(60, 1.2, refSR), sampleRate: refSR });
    session.setMode({ mode: "compare", reference });
    const { events } = run(session, mix(concat(silence(0.5, SR), syntheticPianoNote(60, 1.2, SR), silence(0.6, SR)), hiss(2.3)));
    const comparison = events.find((e) => e.type === "comparison");
    if (comparison?.type !== "comparison") throw new Error("no comparison");
    expect(comparison.finishedEarly).toBe(false);
    expect(comparison.result.strategyId).toBe("timbre");
    expect(comparison.result.score).toBeGreaterThan(75);
  });

  it("ranks instrument samples and picks the right note, using timbre between velocity layers", () => {
    const layer = (kind: "soft" | "loud", seed: number) => {
      const clip = { samples: syntheticPianoLayer(69, 1.5, refSR, kind, seed), sampleRate: refSR };
      return { pitch: pitchStrategy.extract(clip), timbre: timbreStrategy.extract(clip) };
    };
    const soft = layer("soft", 21);
    const loud = layer("loud", 22);
    const candidates = [
      { id: "G#4", ...pianoRef(68) },
      { id: "A4-soft", ...soft },
      { id: "A4-loud", ...loud },
      { id: "A#4", ...pianoRef(70) },
      { id: "A5", ...pianoRef(81) },
    ];
    const session = new ListeningSession(SR);
    session.setMode({ mode: "closest", primary: "pitch", candidates });
    // A loud (bright) A4: should match the loud A4 layer first, then the soft one, then neighbours.
    const { events } = run(session, mix(concat(silence(0.5, SR), syntheticPianoLayer(69, 2, SR, "loud", 5), silence(0.6, SR)), hiss(3.1)));
    const closest = events.find((e) => e.type === "closest");
    if (closest?.type !== "closest") throw new Error("no ranking");
    expect(closest.result.compared).toBe(5);
    expect(closest.result.matches.map((m) => m.id).slice(0, 2)).toEqual(["A4-loud", "A4-soft"]);
    expect(closest.result.matches[0]!.timbreScore).not.toBeNull();
    expect(closest.result.matches[2]!.score).toBe(0);

    // And a soft (dark) A4 prefers the soft layer.
    const softSession = new ListeningSession(SR);
    softSession.setMode({ mode: "closest", primary: "pitch", candidates });
    const softRun = run(softSession, mix(concat(silence(0.5, SR), syntheticPianoLayer(69, 2, SR, "soft", 6), silence(0.6, SR)), hiss(3.1)));
    const softClosest = softRun.events.find((e) => e.type === "closest");
    expect(softClosest?.type === "closest" && softClosest.result.matches[0]!.id).toBe("A4-soft");
  });

  it("returns no matches (with a warning) when the sound has no pitch", () => {
    const session = new ListeningSession(SR);
    session.setMode({ mode: "closest", primary: "pitch", candidates: [{ id: "A4", ...pianoRef(69) }] });
    const { events } = run(session, mix(concat(silence(0.5, SR), whiteNoise(0.6, SR, 0.3, 9), silence(0.6, SR)), hiss(1.7)));
    const closest = events.find((e) => e.type === "closest");
    if (closest?.type !== "closest") throw new Error("no ranking");
    expect(closest.result.matches).toEqual([]);
    expect(closest.result.warnings.map((w) => w.code)).toContain("no_clear_pitch");
  });

  it("rejects malformed reference features", () => {
    const session = new ListeningSession(SR);
    expect(() => session.setMode({ mode: "compare", reference: { strategyId: "pitch", algorithmVersion: "1.0.0", data: { f0Hz: "x" } } })).toThrow();
    expect(() => session.setMode({ mode: "compare", reference: { strategyId: "nope", algorithmVersion: "1.0.0", data: {} } })).toThrow(/Unknown strategy/);
  });
});
