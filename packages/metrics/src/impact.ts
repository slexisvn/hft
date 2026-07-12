import type { FillRecord } from '@hft/contracts';

export interface ImpactSummary {
  readonly p95: number;
  readonly max: number;
  readonly count: number;
}

function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const rank = q * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

export function impactRatioSummary(fills: readonly FillRecord[]): ImpactSummary {
  const ratios: number[] = [];
  let max = 0;
  for (const fill of fills) {
    if (!(fill.depthAtFill > 0)) continue;
    const ratio = fill.size / fill.depthAtFill;
    ratios.push(ratio);
    if (ratio > max) max = ratio;
  }
  if (ratios.length === 0) return { p95: 0, max: 0, count: 0 };
  ratios.sort((a, b) => a - b);
  return { p95: quantileSorted(ratios, 0.95), max, count: ratios.length };
}
