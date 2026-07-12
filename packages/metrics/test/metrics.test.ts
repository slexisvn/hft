import { describe, expect, it } from 'vitest';
import { LIQ_MAKER, LIQ_TAKER, SIDE_ASK, SIDE_BID, type FillRecord } from '@hft/contracts';
import {
  MultiLevelOfi,
  OfiAccumulator,
  WindowedOfi,
  aggressorSign,
  buildFeatureGrid,
  depthImbalance,
  effectiveSpreadTicks,
  fillRatio,
  inventorySummary,
  impactRatioSummary,
  markout,
  markoutBySide,
  markoutVsFillPrice,
  midSeriesFromQuotes,
  pnlRiskSummary,
  realizedSpreadTicks,
  spreadSummary,
  timeWeightedInventory,
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
    depthAtFill: 0,
    spreadTicksAtFill: 0,
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

  it('splits markout by side so adverse selection can be read per direction', () => {
    const both = [fill(SIDE_BID, 0, 100, 100), fill(SIDE_ASK, 0, 100, 100)];
    const s = markoutBySide(both, series, [SECOND]);
    expect(s.bid[0].meanTicks).toBe(-1);
    expect(s.bid[0].count).toBe(1);
    expect(s.ask[0].meanTicks).toBe(1);
    expect(s.ask[0].count).toBe(1);
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

  it('prices improvement against the spread at fill, ignoring the session-average reference', () => {
    const series = { timestampNs: Float64Array.from([0]), midTicks: Float64Array.from([100]) };
    const atFill = { ...fill(SIDE_BID, 0, 99, 100, LIQ_MAKER), spreadTicksAtFill: 2 };
    const withBogusReference = spreadSummary([atFill], series, SECOND, 10);
    expect(withBogusReference.priceImprovementTicksMean).toBe(0);
  });
});

describe('order/depth self-impact ratio', () => {
  const withDepth = (size: number, depth: number): FillRecord => ({
    ...fill(SIDE_BID, 0, 100, 100),
    size,
    depthAtFill: depth,
  });

  it('reports size over depth with p95 and max', () => {
    const s = impactRatioSummary([withDepth(10, 100), withDepth(20, 100), withDepth(50, 100)]);
    expect(s.count).toBe(3);
    expect(s.max).toBeCloseTo(0.5, 12);
    expect(s.p95).toBeGreaterThan(0.2);
    expect(s.p95).toBeLessThanOrEqual(0.5);
  });

  it('skips fills with non-positive depth', () => {
    expect(impactRatioSummary([withDepth(10, 0)]).count).toBe(0);
    expect(impactRatioSummary([]).count).toBe(0);
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

describe('windowed ofi', () => {
  it('returns the trailing-window sum after each update', () => {
    const ofi = new WindowedOfi(1000);
    expect(ofi.update(0, 100, 10, 101, 10)).toBe(0);
    expect(ofi.update(100, 100, 15, 101, 10)).toBe(5);
  });

  it('sums contributions inside the window', () => {
    const ofi = new WindowedOfi(1000);
    ofi.update(0, 100, 10, 101, 10);
    ofi.update(100, 100, 15, 101, 10);
    ofi.update(200, 100, 20, 101, 10);
    expect(ofi.value).toBe(10);
  });

  it('evicts contributions older than the window as time advances', () => {
    const ofi = new WindowedOfi(1000);
    ofi.update(0, 100, 10, 101, 10);
    ofi.update(100, 100, 15, 101, 10);
    ofi.update(200, 100, 20, 101, 10);
    expect(ofi.valueAsOf(1100)).toBe(5);
    expect(ofi.valueAsOf(1200)).toBe(0);
  });

  it('grows its ring buffer without losing contributions', () => {
    const ofi = new WindowedOfi(1_000_000, 2);
    for (let i = 1; i <= 100; i++) ofi.update(i, 100, 10 + i, 101, 10);
    expect(ofi.value).toBe(99);
  });

  it('rejects a non-positive window', () => {
    expect(() => new WindowedOfi(0)).toThrowError(/positive windowNs/);
  });
});

describe('multi-level ofi', () => {
  it('rejects a non-positive depth', () => {
    expect(() => new MultiLevelOfi(0, 1000)).toThrowError(/at least one level/);
  });

  it('weights deeper levels less than the top of book', () => {
    const ofi = new MultiLevelOfi(2, 1_000_000);
    const bidT = [100, 99];
    const bidS = [10, 10];
    const askT = [101, 102];
    const askS = [10, 10];
    ofi.update(0, bidT, bidS, askT, askS, 2);
    ofi.update(100, [100, 99], [15, 30], [101, 102], [10, 10], 2);
    expect(ofi.valueAsOf(100)).toBeCloseTo(5 + 20 / 2);
  });

  it('honours the count argument and skips absent levels', () => {
    const ofi = new MultiLevelOfi(2, 1_000_000);
    ofi.update(0, [100, 99], [10, 10], [101, 102], [10, 10], 1);
    ofi.update(100, [100, 99], [15, 99], [101, 102], [10, 10], 1);
    expect(ofi.valueAsOf(100)).toBeCloseTo(5);
  });
});

describe('feature grid multi-level ofi column', () => {
  it('stays zero without depth columns and moves once depth is supplied', () => {
    const timestampNs = new Float64Array([0, 1000, 2000]);
    const bidTicks = new Int32Array([100, 100, 100]);
    const bidSize = new Int32Array([10, 20, 20]);
    const askTicks = new Int32Array([101, 101, 101]);
    const askSize = new Int32Array([10, 10, 10]);
    const flat = buildFeatureGrid(
      { timestampNs, bidTicks, bidSize, askTicks, askSize },
      { timestampNs: new Float64Array(0), sign: new Int32Array(0) },
      500,
      1_000_000,
    );
    expect(flat.every((r) => r.multiLevelOfi === 0)).toBe(true);

    const withDepth = buildFeatureGrid(
      {
        timestampNs,
        bidTicks,
        bidSize,
        askTicks,
        askSize,
        depthLevels: 2,
        bidLevelTicks: new Int32Array([100, 99, 100, 99, 100, 99]),
        bidLevelSize: new Int32Array([10, 5, 20, 15, 20, 15]),
        askLevelTicks: new Int32Array([101, 102, 101, 102, 101, 102]),
        askLevelSize: new Int32Array([10, 5, 10, 5, 10, 5]),
        bidLevelCount: new Int32Array([2, 2, 2]),
        askLevelCount: new Int32Array([2, 2, 2]),
      },
      { timestampNs: new Float64Array(0), sign: new Int32Array(0) },
      500,
      1_000_000,
    );
    expect(withDepth.some((r) => r.multiLevelOfi !== 0)).toBe(true);
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

  it('time-weights inventory by the dwell at each level', () => {
    expect(timeWeightedInventory(Float64Array.from([0, 10, 20]), Int32Array.from([1, 3, 5]))).toBe(2);
    expect(timeWeightedInventory(Float64Array.from([0]), Int32Array.from([7]))).toBe(7);
    expect(timeWeightedInventory(Float64Array.from([]), Int32Array.from([]))).toBe(0);
  });
});

describe('pnl risk summary', () => {
  it('reports max drawdown as the largest peak-to-trough drop', () => {
    const r = pnlRiskSummary(Float64Array.from([0, 1, 2, 1, 3]));
    expect(r.maxDrawdownTicks).toBe(1);
    expect(r.sharpePerStep).toBeGreaterThan(0);
    expect(r.sortinoPerStep).toBeGreaterThan(0);
  });

  it('has zero drawdown and volatility on a flat curve', () => {
    const r = pnlRiskSummary(Float64Array.from([5, 5, 5, 5]));
    expect(r.maxDrawdownTicks).toBe(0);
    expect(r.sharpePerStep).toBe(0);
    expect(r.sortinoPerStep).toBe(0);
  });

  it('has no downside deviation on a monotonically rising curve', () => {
    const r = pnlRiskSummary(Float64Array.from([0, 1, 2, 3]));
    expect(r.maxDrawdownTicks).toBe(0);
    expect(r.sortinoPerStep).toBe(0);
  });

  it('returns zeros for a degenerate series', () => {
    expect(pnlRiskSummary(Float64Array.from([]))).toEqual({ sharpePerStep: 0, sortinoPerStep: 0, maxDrawdownTicks: 0 });
    expect(pnlRiskSummary(Float64Array.from([1]))).toEqual({ sharpePerStep: 0, sortinoPerStep: 0, maxDrawdownTicks: 0 });
  });
});
