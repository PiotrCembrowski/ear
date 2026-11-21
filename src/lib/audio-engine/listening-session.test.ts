import { describe, expect, it } from "vitest";
import { concat, mix, silence, sine, syntheticFluteNote, syntheticPianoNote, whiteNoise } from "../../../tests/audio/synthetic";
import { ListeningSession, type SessionEvent, type SessionSnapshot } from "./listening-session";

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
