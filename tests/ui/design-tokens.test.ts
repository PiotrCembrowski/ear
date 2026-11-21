/**
 * Checks the design tokens in globals.css against WCAG 2.2 AA contrast:
 *   - normal text: at least 4.5:1
 *   - UI component boundaries and focus indicators: at least 3:1
 *
 * When you add a new text/background combination to the UI, add it here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
const tokens = new Map<string, string>();
for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) {
  tokens.set(match[1]!, match[2]!);
}

/** WCAG relative luminance of an sRGB hex color. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const fg = tokens.get(foreground);
  const bg = tokens.get(background);
  if (!fg || !bg) throw new Error(`Unknown token: ${!fg ? foreground : background}`);
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const surfaces = ["canvas", "surface", "surface-raised", "surface-overlay"];
const textTokens = ["ink", "ink-muted", "ink-subtle", "brand", "brand-strong", "brand-2", "live", "success", "warning", "danger", "info"];
const filledBackgrounds = ["brand", "brand-strong", "brand-2", "live", "success", "warning", "danger"];

describe("design tokens: WCAG AA contrast", () => {
  it("parses the color tokens", () => {
    expect(tokens.size).toBeGreaterThan(15);
  });

  for (const text of textTokens) {
    for (const surface of surfaces) {
      it(`${text} text on ${surface} ≥ 4.5:1`, () => {
        expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const background of filledBackgrounds) {
    it(`ink-inverse text on filled ${background} ≥ 4.5:1`, () => {
      expect(contrast("ink-inverse", background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  for (const series of ["series-1", "series-2"]) {
    it(`chart ${series} on surface ≥ 3:1 (graphical objects)`, () => {
      expect(contrast(series, "surface")).toBeGreaterThanOrEqual(3);
    });
  }

  for (const surface of surfaces) {
    it(`form-control borders on ${surface} ≥ 3:1`, () => {
      expect(contrast("line-control", surface)).toBeGreaterThanOrEqual(3);
    });
    it(`focus ring on ${surface} ≥ 3:1`, () => {
      expect(contrast("brand-strong", surface)).toBeGreaterThanOrEqual(3);
    });
  }
});
