"use client";

import { LineChart } from "@/components/charts/line-chart";
import { median } from "@/lib/audio-engine/math";
import type { ResultVisuals } from "@/lib/audio-engine/types";

const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : "±"}${Math.abs(Math.round(value))}`;
const formatHz = (hz: number) => (hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10_000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`);

/** Pitch over time relative to the reference, with the ±5 cent "in tune" band. */
function PitchTrackChart({ track }: { track: NonNullable<ResultVisuals["pitchTrack"]> }) {
  if (track.cents.length < 2) return null;
  const t0 = track.timeMs[0] ?? 0;
  const x = track.timeMs.map((t) => (t - t0) / 1000);
  const low = Math.min(...track.cents);
  const high = Math.max(...track.cents);
  const centre = median(track.cents);
  const summary = `Your pitch stayed between ${signed(low)} and ${signed(high)} cents of the reference (typically ${signed(centre)}). The shaded band is ±5 cents, where notes sound in tune.`;
  const xMax = x[x.length - 1] ?? 1;
  return (
    <LineChart
      title="Pitch compared with the reference"
      summary={summary}
      x={x}
      series={[{ id: "you", label: "Your pitch", color: "var(--color-series-1)", values: track.cents }]}
      yDomain={[-50, 50]}
      yTicks={[-50, -25, 0, 25, 50]}
      xTicks={[0, xMax / 2, xMax]}
      formatX={(s) => `${s.toFixed(2)} s`}
      formatY={(c) => `${signed(c)}¢`}
      xLabel="Time"
      yLabel="cents"
      band={{ from: -5, to: 5, label: "In tune (±5 cents)" }}
      referenceLine={{ y: 0, label: "Reference pitch" }}
    />
  );
}

/** Average spectrum of your sound vs the reference, each relative to its own loudest band. */
function SpectrumChart({ spectrum }: { spectrum: NonNullable<ResultVisuals["spectrum"]> }) {
  const n = Math.min(spectrum.bandHz.length, spectrum.inputDb.length, spectrum.referenceDb.length);
  if (n < 2) return null;
  const x = spectrum.bandHz.slice(0, n).map((_, i) => i); // bands are evenly spaced on a mel (pitch-like) scale
  const upper = (values: number[]) => values.slice(Math.floor(n / 2), n).reduce((a, b) => a + b, 0) / (n - Math.floor(n / 2));
  const difference = upper(spectrum.inputDb) - upper(spectrum.referenceDb);
  const split = formatHz(spectrum.bandHz[Math.floor(n / 2)] ?? 0);
  const summary =
    Math.abs(difference) < 3
      ? `Your sound and the reference have a similar balance of low and high frequencies.`
      : `Your sound has ${difference > 0 ? "more" : "less"} energy above about ${split} than the reference (${Math.abs(Math.round(difference))} dB on average), so it sounds ${difference > 0 ? "brighter" : "darker"}.`;
  return (
    <LineChart
      title="Frequency balance"
      summary={summary}
      x={x}
      series={[
        { id: "you", label: "Your sound", color: "var(--color-series-1)", values: spectrum.inputDb.slice(0, n) },
        { id: "ref", label: "Reference", color: "var(--color-series-2)", dashed: true, values: spectrum.referenceDb.slice(0, n) },
      ]}
      yDomain={[-80, 0]}
      yTicks={[-80, -60, -40, -20, 0]}
      xTicks={[0, Math.floor((n - 1) / 2), n - 1]}
      formatX={(i) => formatHz(spectrum.bandHz[Math.round(i)] ?? 0)}
      formatY={(db) => `${Math.round(db)} dB`}
      xLabel="Frequency"
      yLabel="dB"
    />
  );
}

/** Loudness over each sound's own length (start → end), relative to its peak. */
function EnvelopeChart({ envelope }: { envelope: NonNullable<ResultVisuals["envelope"]> }) {
  const n = Math.min(envelope.inputDb.length, envelope.referenceDb.length);
  if (n < 2) return null;
  const x = Array.from({ length: n }, (_, i) => (i / (n - 1)) * 100);
  const half = (values: number[]) => values.slice(Math.floor(n / 2)).reduce((a, b) => a + b, 0) / (n - Math.floor(n / 2));
  const difference = half(envelope.inputDb) - half(envelope.referenceDb);
  const summary =
    Math.abs(difference) < 4
      ? "Your sound rises and fades much like the reference."
      : `In its second half your sound is ${Math.abs(Math.round(difference))} dB ${difference > 0 ? "louder" : "quieter"} than the reference (relative to each one's peak), so it ${difference > 0 ? "sustains longer" : "fades faster"}.`;
  return (
    <LineChart
      title="Loudness shape"
      summary={summary}
      x={x}
      series={[
        { id: "you", label: "Your sound", color: "var(--color-series-1)", values: envelope.inputDb.slice(0, n) },
        { id: "ref", label: "Reference", color: "var(--color-series-2)", dashed: true, values: envelope.referenceDb.slice(0, n) },
      ]}
      yDomain={[-60, 0]}
      yTicks={[-60, -40, -20, 0]}
      xTicks={[0, 50, 100]}
      formatX={(p) => `${Math.round(p)}%`}
      formatY={(db) => `${Math.round(db)} dB`}
      xLabel="Through the sound"
      yLabel="dB"
    />
  );
}

export function ResultVisualsView({ visuals }: { visuals: ResultVisuals }) {
  const charts = [
    visuals.pitchTrack && <PitchTrackChart key="pitch" track={visuals.pitchTrack} />,
    visuals.envelope && <EnvelopeChart key="envelope" envelope={visuals.envelope} />,
    visuals.spectrum && <SpectrumChart key="spectrum" spectrum={visuals.spectrum} />,
  ].filter(Boolean);
  if (charts.length === 0) return null;
  return <div className="flex flex-col gap-6">{charts}</div>;
}
