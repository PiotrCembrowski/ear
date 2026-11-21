"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Small, dependency-free SVG line chart for result visuals.
 *
 * Accessibility and clarity rules (see docs/ARCHITECTURE.md → UI):
 *  - one y-axis; thin 2px lines; recessive grid;
 *  - identity never by colour alone: legend always shown for 2+ series, and
 *    the reference series is also dashed;
 *  - a written summary (figcaption) and a "Show data" table carry the same
 *    information for screen readers and for anyone who prefers numbers;
 *  - hover OR arrow keys move a crosshair with a tooltip.
 */

export type ChartSeries = {
  id: string;
  label: string;
  /** CSS colour, normally a series token, e.g. var(--color-series-1). */
  color: string;
  dashed?: boolean;
  values: number[];
};

type LineChartProps = {
  title: string;
  /** One or two sentences saying what the chart shows (screen-reader and visible caption). */
  summary: string;
  x: number[];
  series: ChartSeries[];
  yDomain: [number, number];
  yTicks: number[];
  xTicks: number[];
  formatX: (x: number) => string;
  formatY: (y: number) => string;
  xLabel: string;
  /** Unit name for the data table's column headers (tick labels carry the unit on the chart itself). */
  yLabel: string;
  /** Optional shaded band, e.g. ±5 cents "in tune". */
  band?: { from: number; to: number; label: string };
  /** Optional horizontal reference line, e.g. 0 cents. */
  referenceLine?: { y: number; label: string };
};

/** Drawn at the container's real width (min 300px), so 11px labels stay readable on phones. */
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 300;
const HEIGHT = 220;
const PAD = { top: 12, right: 16, bottom: 34, left: 52 };

export function LineChart(props: LineChartProps) {
  const { title, summary, x, series, yDomain, yTicks, xTicks, formatX, formatY, xLabel, yLabel, band, referenceLine } = props;
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [WIDTH, setWidth] = useState(DEFAULT_WIDTH);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(MIN_WIDTH, Math.round(entry.contentRect.width)));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const xMin = x[0] ?? 0;
  const xMax = x[x.length - 1] ?? 1;
  const sx = (value: number) => PAD.left + (xMax === xMin ? 0 : ((value - xMin) / (xMax - xMin)) * innerW);
  const clampY = (value: number) => Math.min(yDomain[1], Math.max(yDomain[0], value));
  const sy = (value: number) => PAD.top + (1 - (clampY(value) - yDomain[0]) / (yDomain[1] - yDomain[0])) * innerH;

  const paths = useMemo(
    () =>
      series.map((s) =>
        s.values
          .map((value, i) => `${i === 0 ? "M" : "L"}${sx(x[i] ?? i).toFixed(1)},${sy(value).toFixed(1)}`)
          .join(" "),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sx/sy derive from the same props
    [series, x, yDomain[0], yDomain[1], WIDTH],
  );

  function indexAt(clientX: number): number {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || x.length === 0) return 0;
    const value = xMin + ((((clientX - rect.left) / rect.width) * WIDTH - PAD.left) / innerW) * (xMax - xMin);
    let best = 0;
    for (let i = 1; i < x.length; i++) if (Math.abs(x[i]! - value) < Math.abs(x[best]! - value)) best = i;
    return best;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    setHover((current) => Math.min(x.length - 1, Math.max(0, (current ?? (step > 0 ? -1 : x.length)) + step)));
  }

  const hoverX = hover !== null ? sx(x[hover] ?? 0) : null;
  const tooltipLeftPercent = hoverX !== null ? (hoverX / WIDTH) * 100 : 0;

  return (
    <figure className="flex flex-col gap-2" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id={`${id}-title`} className="text-sm font-medium text-ink">
          {title}
        </h4>
        {series.length > 1 && (
          <ul className="flex flex-wrap gap-4 text-xs text-ink-muted" aria-label="Legend">
            {series.map((s) => (
              <li key={s.id} className="inline-flex items-center gap-1.5">
                <svg width="18" height="6" aria-hidden>
                  <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
                </svg>
                {s.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="relative" ref={boxRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full touch-none rounded-control focus-visible:outline-2"
          role="img"
          aria-label={`${title}. ${summary} Use the left and right arrow keys to read values.`}
          tabIndex={0}
          onPointerMove={(e: PointerEvent) => setHover(indexAt(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setHover(null)}
        >
          {band && (
            <rect x={PAD.left} y={sy(band.to)} width={innerW} height={Math.max(0, sy(band.from) - sy(band.to))} fill="var(--color-success)" opacity="0.1" />
          )}
          {yTicks.map((tick) => (
            <g key={`y${tick}`}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(tick)} y2={sy(tick)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={PAD.left - 8} y={sy(tick) + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-subtle)">
                {formatY(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((tick) => (
            <text key={`x${tick}`} x={sx(tick)} y={HEIGHT - PAD.bottom + 16} textAnchor="middle" fontSize="11" fill="var(--color-ink-subtle)">
              {formatX(tick)}
            </text>
          ))}
          <text x={PAD.left + innerW / 2} y={HEIGHT - 4} textAnchor="middle" fontSize="11" fill="var(--color-ink-muted)">
            {xLabel}
          </text>
          {referenceLine && (
            <g>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={sy(referenceLine.y)} y2={sy(referenceLine.y)} stroke="var(--color-series-2)" strokeWidth="2" strokeDasharray="4 3" />
              <text x={WIDTH - PAD.right} y={sy(referenceLine.y) - 6} textAnchor="end" fontSize="11" fill="var(--color-ink-muted)">
                {referenceLine.label}
              </text>
            </g>
          )}
          {series.map((s, i) => (
            <path key={s.id} d={paths[i]} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "6 4" : undefined} />
          ))}
          {hoverX !== null && hover !== null && (
            <g aria-hidden>
              <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-ink-subtle)" strokeWidth="1" />
              {series.map((s) =>
                s.values[hover] === undefined ? null : (
                  <circle key={s.id} cx={hoverX} cy={sy(s.values[hover]!)} r="4" fill={s.color} stroke="var(--color-surface)" strokeWidth="2" />
                ),
              )}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-control border border-line-strong bg-surface-overlay px-2.5 py-1.5 text-xs shadow-card"
            style={{ left: `${Math.min(85, Math.max(15, tooltipLeftPercent))}%` }}
          >
            <p className="text-ink-muted">{formatX(x[hover] ?? 0)}</p>
            {series.map((s) => (
              <p key={s.id} className="font-mono text-ink">
                <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: s.color }} />
                {s.label}: {s.values[hover] === undefined ? "—" : formatY(s.values[hover]!)}
              </p>
            ))}
          </div>
        )}
      </div>
      <figcaption className="text-xs leading-relaxed text-ink-muted">{summary}</figcaption>
      <details className="text-xs text-ink-muted">
        <summary className="cursor-pointer select-none hover:text-ink">Show data</summary>
        <div className="mt-2 max-h-48 overflow-auto rounded-control border border-line">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface-raised">
              <tr>
                <th scope="col" className="px-2 py-1 font-medium">{xLabel}</th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="px-2 py-1 font-medium">
                    {s.label} ({yLabel})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {x.map((xValue, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-2 py-0.5">{formatX(xValue)}</td>
                  {series.map((s) => (
                    <td key={s.id} className="px-2 py-0.5 text-ink">
                      {s.values[i] === undefined ? "—" : formatY(s.values[i]!)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
