/**
 * Dynamic Time Warping: aligns two sequences that may run at different
 * speeds (a note held a bit longer, a slower attack) and measures how
 * different they are once aligned.
 *
 * Cost matrix D[i][j] = cost(i, j) + min(D[i−1][j], D[i][j−1], D[i−1][j−1]).
 * The result is the average cost per step along the best path, so long and
 * short sequences are comparable.
 *
 * Two practical refinements:
 *  - Sakoe–Chiba band: only cells within `band` of the (stretched) diagonal
 *    are considered. This forbids absurd alignments (the whole input matched
 *    to one reference frame) and saves work.
 *  - Relaxed endpoints: the path may start within the first `freeEnds` cells
 *    of either sequence and end within the last `freeEnds`, so a slightly
 *    early or late event boundary doesn't count as a difference.
 */

export type DtwOptions = {
  /** Half-width of the band around the diagonal, in frames. Default: 25% of the longer sequence. */
  band?: number;
  /** Frames at each end that may be skipped for free. Default: 10% of the shorter sequence (≥ 1). */
  freeEnds?: number;
};

export type DtwResult = {
  /** Mean cost per step along the best path. */
  meanCost: number;
  /** Aligned index pairs [i, j], from start to end. */
  path: Array<[number, number]>;
};

export function dtw(n: number, m: number, cost: (i: number, j: number) => number, options: DtwOptions = {}): DtwResult {
  if (n === 0 || m === 0) return { meanCost: Number.POSITIVE_INFINITY, path: [] };
  // The band must at least cover the length difference, or no path exists.
  const band = Math.max(options.band ?? Math.ceil(0.25 * Math.max(n, m)), Math.abs(n - m) + 1, 2);
  const freeEnds = Math.max(1, Math.min(options.freeEnds ?? Math.round(0.1 * Math.min(n, m)), Math.min(n, m) - 1) || 1);

  const total = new Float64Array(n * m).fill(Number.POSITIVE_INFINITY);
  const steps = new Uint32Array(n * m);
  /** Back-pointer per cell: 0 = path start, 1 = diagonal, 2 = from above (i−1), 3 = from the left (j−1). */
  const from = new Uint8Array(n * m);
  const inBand = (i: number, j: number) => Math.abs(j - (n === 1 ? 0 : (i * (m - 1)) / (n - 1))) <= band;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (!inBand(i, j)) continue;
      const c = cost(i, j);
      const index = i * m + j;
      // Free start: the first `freeEnds` cells of row 0 / column 0 can begin a path.
      if ((i === 0 && j < freeEnds) || (j === 0 && i < freeEnds)) {
        total[index] = c;
        steps[index] = 1;
        continue;
      }
      let best = Number.POSITIVE_INFINITY;
      let bestSteps = 0;
      let bestFrom = 0;
      const consider = (pi: number, pj: number, direction: number) => {
        if (pi < 0 || pj < 0) return;
        const p = pi * m + pj;
        // Compare by average cost so far, so long detours don't look cheap.
        const candidate = total[p]!;
        if (candidate === Number.POSITIVE_INFINITY) return;
        if (bestSteps === 0 || candidate / steps[p]! < best / bestSteps) {
          best = candidate;
          bestSteps = steps[p]!;
          bestFrom = direction;
        }
      };
      consider(i - 1, j - 1, 1);
      consider(i - 1, j, 2);
      consider(i, j - 1, 3);
      if (bestSteps > 0) {
        total[index] = best + c;
        steps[index] = bestSteps + 1;
        from[index] = bestFrom;
      }
    }
  }

  // Free end: best average among the last `freeEnds` cells of the last row/column.
  let end: [number, number] | null = null;
  let endMean = Number.POSITIVE_INFINITY;
  const considerEnd = (i: number, j: number) => {
    const index = i * m + j;
    if (steps[index]! > 0 && total[index]! / steps[index]! < endMean) {
      endMean = total[index]! / steps[index]!;
      end = [i, j];
    }
  };
  for (let j = Math.max(0, m - freeEnds); j < m; j++) considerEnd(n - 1, j);
  for (let i = Math.max(0, n - freeEnds); i < n; i++) considerEnd(i, m - 1);
  if (!end) return { meanCost: Number.POSITIVE_INFINITY, path: [] };

  // Follow the back-pointers to the start of the path.
  const path: Array<[number, number]> = [];
  let [i, j] = end as [number, number];
  for (;;) {
    path.push([i, j]);
    const direction = from[i * m + j];
    if (direction === 1) {
      i--;
      j--;
    } else if (direction === 2) i--;
    else if (direction === 3) j--;
    else break;
  }
  path.reverse();
  return { meanCost: endMean, path };
}
