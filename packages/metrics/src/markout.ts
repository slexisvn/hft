import { SIDE_BID, type FillRecord, type MarkoutPoint, type Nanos } from '@hft/contracts';

export interface MidSeries {
  readonly timestampNs: Float64Array;
  readonly midTicks: Float64Array;
}

export function sideSign(side: number): number {
  return side === SIDE_BID ? 1 : -1;
}

export class MidLookup {
  private readonly series: MidSeries;
  private cursor = 0;

  constructor(series: MidSeries) {
    this.series = series;
  }

  reset(): void {
    this.cursor = 0;
  }

  atOrBefore(tNs: Nanos): number {
    const ts = this.series.timestampNs;
    const n = ts.length;
    if (n === 0 || tNs < ts[0] || tNs > ts[n - 1]) return NaN;
    while (this.cursor + 1 < n && ts[this.cursor + 1] <= tNs) this.cursor++;
    return this.series.midTicks[this.cursor];
  }
}

export function markout(
  fills: readonly FillRecord[],
  series: MidSeries,
  horizonsNs: readonly Nanos[],
): MarkoutPoint[] {
  const out: MarkoutPoint[] = [];
  for (const horizon of horizonsNs) {
    const lookup = new MidLookup(series);
    let sumTicks = 0;
    let sumBps = 0;
    let count = 0;
    for (const fill of fills) {
      const future = lookup.atOrBefore(fill.timestampNs + horizon);
      if (!Number.isFinite(future) || !Number.isFinite(fill.midTicksAtFill)) continue;
      const delta = sideSign(fill.side) * (future - fill.midTicksAtFill);
      sumTicks += delta * fill.size;
      sumBps += (delta / fill.midTicksAtFill) * 10000 * fill.size;
      count += fill.size;
    }
    out.push({
      horizonNs: horizon,
      meanTicks: count === 0 ? 0 : sumTicks / count,
      meanBps: count === 0 ? 0 : sumBps / count,
      count,
    });
  }
  return out;
}

export function markoutVsFillPrice(
  fills: readonly FillRecord[],
  series: MidSeries,
  horizonsNs: readonly Nanos[],
): MarkoutPoint[] {
  const out: MarkoutPoint[] = [];
  for (const horizon of horizonsNs) {
    const lookup = new MidLookup(series);
    let sumTicks = 0;
    let sumBps = 0;
    let count = 0;
    for (const fill of fills) {
      const future = lookup.atOrBefore(fill.timestampNs + horizon);
      if (!Number.isFinite(future)) continue;
      const delta = sideSign(fill.side) * (future - fill.priceTicks);
      sumTicks += delta * fill.size;
      sumBps += (delta / fill.priceTicks) * 10000 * fill.size;
      count += fill.size;
    }
    out.push({
      horizonNs: horizon,
      meanTicks: count === 0 ? 0 : sumTicks / count,
      meanBps: count === 0 ? 0 : sumBps / count,
      count,
    });
  }
  return out;
}

export function midSeriesFromQuotes(timestampNs: Float64Array, bidTicks: Int32Array, askTicks: Int32Array): MidSeries {
  const n = timestampNs.length;
  const ts = new Float64Array(n);
  const mid = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (bidTicks[i] < 0 || askTicks[i] < 0) continue;
    ts[k] = timestampNs[i];
    mid[k] = (bidTicks[i] + askTicks[i]) / 2;
    k++;
  }
  return { timestampNs: ts.subarray(0, k), midTicks: mid.subarray(0, k) };
}
