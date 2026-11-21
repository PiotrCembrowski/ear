"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";

type View = "waveform" | "spectrum";

/**
 * Live waveform or spectrum drawn from the Web Audio AnalyserNode on the UI
 * thread (visual only; the analysis itself runs in the worker). Decorative
 * for screen readers: the tuner and level meter carry the same information
 * as text.
 */
export function LiveVisualizer({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [view, setView] = useState<View>("waveform");

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const styles = getComputedStyle(document.documentElement);
    const brand = styles.getPropertyValue("--color-brand").trim() || "#8b7bff";
    const brand2 = styles.getPropertyValue("--color-brand-2").trim() || "#22d3ee";
    const grid = styles.getPropertyValue("--color-line").trim() || "#252a3a";

    let frame = 0;
    const timeData = new Float32Array(analyser?.fftSize ?? 2048);
    const freqData = new Float32Array(analyser?.frequencyBinCount ?? 1024);

    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * ratio)) canvas.width = Math.round(width * ratio);
      if (canvas.height !== Math.round(height * ratio)) canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = grid;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(0, height / 2);
      context.lineTo(width, height / 2);
      context.stroke();

      if (analyser && active) {
        const gradient = context.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, brand);
        gradient.addColorStop(1, brand2);
        if (view === "waveform") {
          analyser.getFloatTimeDomainData(timeData);
          context.strokeStyle = gradient;
          context.lineWidth = 2;
          context.beginPath();
          for (let i = 0; i < timeData.length; i++) {
            const x = (i / (timeData.length - 1)) * width;
            const y = height / 2 - timeData[i]! * (height / 2) * 0.9;
            if (i === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          }
          context.stroke();
        } else {
          analyser.getFloatFrequencyData(freqData);
          // Log-frequency axis from 30 Hz to Nyquist: music is spread evenly in octaves.
          const nyquist = analyser.context.sampleRate / 2;
          const bars = Math.max(32, Math.floor(width / 5));
          context.fillStyle = gradient;
          for (let b = 0; b < bars; b++) {
            const f0 = 30 * (nyquist / 30) ** (b / bars);
            const f1 = 30 * (nyquist / 30) ** ((b + 1) / bars);
            const k0 = Math.floor((f0 / nyquist) * freqData.length);
            const k1 = Math.max(k0 + 1, Math.floor((f1 / nyquist) * freqData.length));
            let peak = -Infinity;
            for (let k = k0; k < k1 && k < freqData.length; k++) peak = Math.max(peak, freqData[k]!);
            const magnitude = Math.max(0, Math.min(1, (peak + 100) / 80)); // −100 … −20 dB
            const barHeight = magnitude * height;
            context.fillRect((b / bars) * width, height - barHeight, width / bars - 1, barHeight);
          }
        }
      }
      if (active) frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [analyser, active, view]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-muted">Live view</span>
        <div role="group" aria-label="Live view type" className="inline-flex rounded-control border border-line bg-surface-raised p-0.5">
          {(["waveform", "spectrum"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cx(
                "rounded-[0.5rem] px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                view === option ? "bg-surface-overlay text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <canvas ref={canvasRef} aria-hidden className="h-28 w-full rounded-control border border-line bg-canvas/60" />
    </div>
  );
}
