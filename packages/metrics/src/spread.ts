import { LIQ_TAKER, type FillRecord } from '@hft/contracts';
import { MidLookup, sideSign, type MidSeries } from './markout';

export function aggressorSign(fill: FillRecord): number {
  const s = sideSign(fill.side);
  return fill.liquidity === LIQ_TAKER ? s : -s;
}

export function effectiveSpreadTicks(priceTicks: number, midTicks: number, aggressor: number): number {
  return 2 * aggressor * (priceTicks - midTicks);
}

export function realizedSpreadTicks(priceTicks: number, midAfterTicks: number, aggressor: number): number {
  return 2 * aggressor * (priceTicks - midAfterTicks);
}

export function priceImprovementTicks(priceTicks: number, referenceTicks: number, aggressor: number): number {
  return aggressor * (referenceTicks - priceTicks);
}

export interface SpreadSummary {
  readonly effectiveSpreadTicksMean: number;
  readonly realizedSpreadTicksMean: number;
  readonly priceImprovementTicksMean: number;
}

export function spreadSummary(
  fills: readonly FillRecord[],
  series: MidSeries,
  realizedHorizonNs: number,
  halfSpreadReferenceTicks: number,
): SpreadSummary {
  const lookup = new MidLookup(series);
  let eff = 0;
  let effN = 0;
  let real = 0;
  let realN = 0;
  let imp = 0;
  let impN = 0;

  for (const fill of fills) {
    if (!Number.isFinite(fill.midTicksAtFill)) continue;
    const a = aggressorSign(fill);
    eff += effectiveSpreadTicks(fill.priceTicks, fill.midTicksAtFill, a) * fill.size;
    effN += fill.size;

    const reference = fill.midTicksAtFill + a * halfSpreadReferenceTicks;
    imp += priceImprovementTicks(fill.priceTicks, reference, a) * fill.size;
    impN += fill.size;

    const future = lookup.atOrBefore(fill.timestampNs + realizedHorizonNs);
    if (Number.isFinite(future)) {
      real += realizedSpreadTicks(fill.priceTicks, future, a) * fill.size;
      realN += fill.size;
    }
  }

  return {
    effectiveSpreadTicksMean: effN === 0 ? 0 : eff / effN,
    realizedSpreadTicksMean: realN === 0 ? 0 : real / realN,
    priceImprovementTicksMean: impN === 0 ? 0 : imp / impN,
  };
}
