import { describe, expect, it } from 'vitest';
import { SIDE_ASK, SIDE_BID } from '@hft/contracts';
import { createTickScale } from '@hft/events';
import {
  SnapshotCache,
  dispatchFeedMessage,
  parseAccountSnapshot,
  parseBaseAssetPosition,
  parseOpenOrders,
  type BinanceDepthUpdate,
  type BinanceFeedTarget,
  type ExecutionReport,
} from '@hft/binance';

const SCALE = createTickScale(0.01, 100);

function recorder(): {
  target: BinanceFeedTarget;
  depth: BinanceDepthUpdate[];
  trades: { ts: number; px: number; size: number; maker: boolean }[];
  reports: ExecutionReport[];
} {
  const depth: BinanceDepthUpdate[] = [];
  const trades: { ts: number; px: number; size: number; maker: boolean }[] = [];
  const reports: ExecutionReport[] = [];
  return {
    depth,
    trades,
    reports,
    target: {
      onDepthUpdate: (u) => depth.push(u),
      onTrade: (ts, px, size, maker) => trades.push({ ts, px, size, maker }),
      onExecutionReport: (r) => reports.push(r),
    },
  };
}

describe('binance ws feed dispatch', () => {
  it('parses and routes a depth update', () => {
    const r = recorder();
    dispatchFeedMessage(
      JSON.stringify({ e: 'depthUpdate', U: 10, u: 15, b: [['50.00', '3']], a: [['50.05', '1']] }),
      r.target,
      SCALE,
    );
    expect(r.depth[0]).toEqual({ firstUpdateId: 10, finalUpdateId: 15, bids: [['50.00', '3']], asks: [['50.05', '1']] });
  });

  it('parses a trade into ticks and nanoseconds', () => {
    const r = recorder();
    dispatchFeedMessage(JSON.stringify({ e: 'trade', T: 1700, p: '50.00', q: '2', m: true }), r.target, SCALE);
    expect(r.trades[0]).toEqual({ ts: 1700 * 1_000_000, px: 5000, size: 2, maker: true });
  });

  it('parses an execution report, computing remaining quantity', () => {
    const r = recorder();
    dispatchFeedMessage(
      JSON.stringify({ e: 'executionReport', c: 'abc', X: 'PARTIALLY_FILLED', T: 42, l: '3', L: '50.00', q: '10', z: '3', m: false }),
      r.target,
      SCALE,
    );
    expect(r.reports[0]).toEqual({
      clientOrderId: 'abc',
      status: 'PARTIALLY_FILLED',
      transactTimeNs: 42_000_000,
      lastFilledQty: 3,
      lastFilledPriceTicks: 5000,
      remainingQty: 7,
      isMaker: false,
    });
  });

  it('unwraps a combined-stream envelope and ignores unknown events', () => {
    const r = recorder();
    dispatchFeedMessage(JSON.stringify({ stream: 'x', data: { e: 'trade', T: 1, p: '50.00', q: '1', m: false } }), r.target, SCALE);
    dispatchFeedMessage(JSON.stringify({ e: 'somethingElse' }), r.target, SCALE);
    expect(r.trades.length).toBe(1);
  });
});

describe('binance account parsing', () => {
  it('maps open orders to snapshots', () => {
    const orders = parseOpenOrders(
      JSON.stringify([
        { clientOrderId: 'a', side: 'BUY', price: '50.00', origQty: '10', executedQty: '4', status: 'PARTIALLY_FILLED' },
        { clientOrderId: 'b', side: 'SELL', price: '50.10', origQty: '5', executedQty: '0', status: 'NEW' },
      ]),
      SCALE,
    );
    expect(orders[0]).toEqual({ clientOrderId: 'a', side: SIDE_BID, priceTicks: 5000, size: 10, remaining: 6, state: 'partial' });
    expect(orders[1]).toMatchObject({ side: SIDE_ASK, priceTicks: 5010, remaining: 5, state: 'acked' });
  });

  it('sums free and locked base balance for the position', () => {
    const account = JSON.stringify({ balances: [{ asset: 'BTC', free: '1.5', locked: '0.5' }, { asset: 'USDT', free: '100', locked: '0' }] });
    expect(parseBaseAssetPosition(account, 'BTC')).toBe(2);
    expect(parseBaseAssetPosition(account, 'ETH')).toBe(0);
  });

  it('assembles a full account snapshot', () => {
    const snap = parseAccountSnapshot(
      JSON.stringify({ balances: [{ asset: 'BTC', free: '3', locked: '0' }] }),
      JSON.stringify([{ clientOrderId: 'a', side: 'BUY', price: '50.00', origQty: '2', executedQty: '0', status: 'NEW' }]),
      SCALE,
      'BTC',
    );
    expect(snap.position).toBe(3);
    expect(snap.openOrders.length).toBe(1);
  });
});

describe('SnapshotCache', () => {
  it('throws until set, then returns the latest and reports age', () => {
    const cache = new SnapshotCache<number>();
    expect(() => cache.require()).toThrowError(/empty/);
    cache.set(42, 1000);
    expect(cache.require()).toBe(42);
    expect(cache.ageNs(1500)).toBe(500);
  });
});
