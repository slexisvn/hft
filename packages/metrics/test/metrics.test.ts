import { describe, expect, it } from 'vitest';
import { LIQ_MAKER, LIQ_TAKER, SIDE_ASK, SIDE_BID, type FillRecord } from '@hft/contracts';
import {
  OfiAccumulator,
  aggressorSign,
  depthImbalance,
  effectiveSpreadTicks,
  fillRatio,
  inventorySummary,
  markout,
  markoutVsFillPrice,
  midSeriesFromQuotes,
  realizedSpreadTicks,
  spreadSummary,
} from '@hft/metrics';

const SECOND = 1_000_000_000;

function fill(side: 0 | 1, ts: number, price: number, mid: number, liq: 0 | 1 = LIQ_MAKER): FillRecord {
  return {
    timestampNs: ts,
    clientOrderId: 'a',
    side,
    priceTicks: price,
    size: 1,
    queuePositionAtFill: 0,
    midTicksAtFill: mid,
    liquidity: liq,
  };
}

describe('markout', () => {
  const series = {
    timestampNs: Float64Array.from([0, SECOND, 2 * SECOND]),
    midTicks: Float64Array.from([100, 99, 98]),
  };

  it('is negative for a buy when the mid falls afterwards', () => {
    const m = markout([fill(SIDE_BID, 0, 100, 100)], series, [SECOND]);
    expect(m[0].meanTicks).toBe(-1);
    expect(m[0].count).toBe(1);
  });

  it('is positive for a sell when the mid falls afterwards', () => {
    const m = markout([fill(SIDE_ASK, 0, 100, 100)], series, [SECOND]);
    expect(m[0].meanTicks).toBe(1);
  });

  it('skips fills whose horizon runs past the end of the mid series', () => {
    const m = markout([fill(SIDE_BID, 2 * SECOND, 98, 98)], series, [SECOND]);
    expect(m[0].count).toBe(0);
    expect(m[0].meanTicks).toBe(0);
  });

  it('reports one point per configured horizon', () => {
    const m = markout([fill(SIDE_BID, 0, 100, 100)], series, [SECOND, 2 * SECOND]);
    expect(m.map((p) => p.horizonNs)).toEqual([SECOND, 2 * SECOND]);
    expect(m[1].meanTicks).toBe(-2);
  });

  it('separates captured edge from adverse selection by measuring against the fill price', () => {
    const passiveBuyAtBid = fill(SIDE_BID, 0, 99, 100);
    const vsMid = markout([passiveBuyAtBid], series, [SECOND]);
    const vsPrice = markoutVsFillPrice([passiveBuyAtBid], series, [SECOND]);
    expect(vsMid[0].meanTicks).toBe(-1);
    expect(vsPrice[0].meanTicks).toBe(0);
  });

  it('builds a mid series only from two-sided quotes', () => {
    const s = midSeriesFromQuotes(
      Float64Array.from([0, 1, 2]),
      Int32Array.from([-1, 100, 100]),
      Int32Array.from([102, -1, 102]),
    );
    expect(Array.from(s.timestampNs)).toEqual([2]);
    expect(Array.from(s.midTicks)).toEqual([101]);
  });
});

describe('spread', () => {
  it('flips the aggressor sign for maker versus taker fills', () => {
    expect(aggressorSign(fill(SIDE_BID, 0, 100, 100, LIQ_MAKER))).toBe(-1);
    expect(aggressorSign(fill(SIDE_BID, 0, 100, 100, LIQ_TAKER))).toBe(1);
  });

  it('computes effective and realized spread as twice the signed distance from the mid', () => {
    expect(effectiveSpreadTicks(101, 100, 1)).toBe(2);
    expect(realizedSpreadTicks(101, 100.5, 1)).toBe(1);
  });

  it('a passive buy at the bid earns a positive effective spread', () => {
    const series = { timestampNs: Float64Array.from([0]), midTicks: Float64Array.from([100]) };
    const s = spreadSummary([fill(SIDE_BID, 0, 99, 100, LIQ_MAKER)], series, SECOND, 1);
    expect(s.effectiveSpreadTicksMean).toBe(2);
  });
});

describe('ofi', () => {
  it('is zero on the first update', () => {
    const ofi = new OfiAccumulator();
    expect(ofi.update(100, 10, 101, 10)).toBe(0);
  });

  it('is positive when bid size grows and negative when ask size grows', () => {
    const ofi = new OfiAccumulator();
    ofi.update(100, 10, 101, 10);
    expect(ofi.update(100, 15, 101, 10)).toBe(5);
    ofi.reset();
    const ofi2 = new OfiAccumulator();
    ofi2.update(100, 10, 101, 10);
    expect(ofi2.update(100, 10, 101, 15)).toBe(-5);
  });

  it('counts a bid price improvement as full added size', () => {
    const ofi = new OfiAccumulator();
    ofi.update(100, 10, 102, 10);
    expect(ofi.update(101, 7, 102, 10)).toBe(7);
  });

  it('counts a bid price retreat as full removed size', () => {
    const ofi = new OfiAccumulator();
    ofi.update(100, 10, 102, 10);
    expect(ofi.update(99, 7, 102, 10)).toBe(-10);
  });

  it('accumulates until reset', () => {
    const ofi = new OfiAccumulator();
    ofi.update(100, 10, 101, 10);
    ofi.update(100, 15, 101, 10);
    ofi.update(100, 20, 101, 10);
    expect(ofi.value).toBe(10);
    ofi.reset();
    expect(ofi.value).toBe(0);
  });
});

describe('depth imbalance and inventory', () => {
  it('is +1 when only bids rest and -1 when only asks rest', () => {
    expect(depthImbalance(10, 0)).toBe(1);
    expect(depthImbalance(0, 10)).toBe(-1);
    expect(depthImbalance(0, 0)).toBe(0);
  });

  it('summarises the inventory path', () => {
    const s = inventorySummary(Int32Array.from([1, -2, 3]));
    expect(s.min).toBe(-2);
    expect(s.max).toBe(3);
    expect(s.end).toBe(3);
    expect(s.mean).toBeCloseTo(2 / 3, 12);
  });

  it('reports a zero fill ratio when nothing was submitted', () => {
    expect(fillRatio(0, 0)).toBe(0);
    expect(fillRatio(3, 6)).toBe(0.5);
  });
});
