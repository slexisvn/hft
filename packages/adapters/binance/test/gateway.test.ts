import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  LIQ_MAKER,
  LIQ_TAKER,
  OrderStateError,
  SIDE_ASK,
  SIDE_BID,
  type Clock,
  type FillRecord,
  type OrderRequest,
} from '@hft/contracts';
import { createTickScale } from '@hft/events';
import { BinanceGateway, type BinanceDepthUpdate, type ExecutionReport, type OrderTransport } from '@hft/binance';

class FakeClock implements Clock {
  t = 0;
  now(): number {
    return this.t;
  }
}

class FakeTransport implements OrderTransport {
  readonly name = 'fake';
  readonly sent: OrderRequest[] = [];
  readonly canceled: string[] = [];
  sendOrder(request: OrderRequest): void {
    this.sent.push(request);
  }
  cancelOrder(clientOrderId: string): void {
    this.canceled.push(clientOrderId);
  }
}

const SCALE = createTickScale(0.01, 10000);

interface Harness {
  gw: BinanceGateway;
  transport: FakeTransport;
  clock: FakeClock;
  fills: FillRecord[];
  rejects: string[];
  resyncs: number;
}

function harness(withTransport = true): Harness {
  const clock = new FakeClock();
  const transport = new FakeTransport();
  const fills: FillRecord[] = [];
  const rejects: string[] = [];
  const h = { resyncs: 0 };
  const gw = new BinanceGateway(
    { minPriceTicks: 9000, maxPriceTicks: 11000 },
    SCALE,
    clock,
    withTransport ? transport : null,
    {
      onFill: (f) => fills.push(f),
      onOrderRejected: (id) => rejects.push(id),
      onResyncRequired: () => h.resyncs++,
    },
  );
  return {
    gw,
    transport,
    clock,
    fills,
    rejects,
    get resyncs(): number {
      return h.resyncs;
    },
  } as Harness;
}

function depth(firstUpdateId: number, finalUpdateId: number, bids: [string, string][], asks: [string, string][]): BinanceDepthUpdate {
  return { firstUpdateId, finalUpdateId, bids, asks };
}

function order(id: string, side: 0 | 1, priceTicks: number, size: number): OrderRequest {
  return { clientOrderId: id, side, priceTicks, size, postOnly: true };
}

function report(partial: Partial<ExecutionReport> & { clientOrderId: string; status: ExecutionReport['status'] }): ExecutionReport {
  return {
    transactTimeNs: 1,
    lastFilledQty: 0,
    lastFilledPriceTicks: 0,
    remainingQty: 0,
    isMaker: true,
    ...partial,
  };
}

function synced(): Harness {
  const h = harness();
  h.gw.onDepthUpdate(depth(10, 14, [], []));
  h.gw.onDepthSnapshot({
    lastUpdateId: 9,
    bids: [
      ['99.99', '50'],
      ['99.98', '20'],
    ],
    asks: [
      ['100.01', '40'],
      ['100.02', '60'],
    ],
  });
  return h;
}

describe('BinanceGateway order book', () => {
  it('buffers depth updates until the snapshot, then serves a live market view', () => {
    const h = synced();
    expect(h.gw.isSynced).toBe(true);
    const view = h.gw.marketView();
    expect(view.bestBidTicks()).toBe(9999);
    expect(view.bestAskTicks()).toBe(10001);
    expect(view.midTicks()).toBe(10000);
    expect(view.sizeAt(SIDE_BID, 9999)).toBe(50);
  });

  it('applies contiguous depth updates and removes a level whose quantity goes to zero', () => {
    const h = synced();
    expect(h.gw.onDepthUpdate(depth(15, 16, [['99.99', '0']], []))).toBe('applied');
    expect(h.gw.marketView().bestBidTicks()).toBe(9998);
  });

  it('asks for a resync on a depth gap instead of drifting silently', () => {
    const h = synced();
    expect(h.gw.onDepthUpdate(depth(99, 100, [], []))).toBe('resync_required');
    expect(h.resyncs).toBe(1);
    expect(h.gw.isSynced).toBe(false);
  });

  it('rebuilds the book and reattaches queue cursors after a snapshot resync', () => {
    const h = synced();
    h.gw.submit(order('a', SIDE_BID, 9999, 5));
    h.gw.onExecutionReport(report({ clientOrderId: 'a', status: 'NEW' }));
    h.gw.onDepthSnapshot({ lastUpdateId: 20, bids: [['99.99', '11']], asks: [['100.01', '40']] });
    h.gw.onExecutionReport(report({ clientOrderId: 'a', status: 'PARTIALLY_FILLED', lastFilledQty: 1, lastFilledPriceTicks: 9999, remainingQty: 4 }));
    expect(h.fills[0].queuePositionAtFill).toBe(11);
  });
});

describe('BinanceGateway order lifecycle', () => {
  it('refuses to trade without an order transport', () => {
    const h = harness(false);
    expect(() => h.gw.submit(order('a', SIDE_BID, 9999, 5))).toThrowError(ConfigError);
    expect(() => h.gw.cancel('a')).toThrowError(ConfigError);
  });

  it('sends the order and exposes it as pending until the exchange acks', () => {
    const h = synced();
    h.gw.submit(order('a', SIDE_BID, 9999, 5));
    expect(h.transport.sent.length).toBe(1);
    expect(h.gw.openOrders()[0].state).toBe('pending');
    h.gw.onExecutionReport(report({ clientOrderId: 'a', status: 'NEW' }));
    expect(h.gw.openOrders()[0].state).toBe('acked');
  });

  it('refuses to reuse a working client order id', () => {
    const h = synced();
    h.gw.submit(order('a', SIDE_BID, 9999, 5));
    expect(() => h.gw.submit(order('a', SIDE_BID, 9999, 5))).toThrowError(OrderStateError);
  });

  it('never cancels an order it does not know', () => {
    const h = synced();
    h.gw.cancel('ghost');
    expect(h.transport.canceled).toEqual([]);
  });

  it('records a maker fill with the queue position the cursor observed', () => {
    const h = synced();
    h.gw.submit(order('a', SIDE_BID, 9999, 5));
    h.gw.onExecutionReport(report({ clientOrderId: 'a', status: 'NEW' }));
    h.gw.onTrade(2, 9999, 30, true);
    h.gw.onExecutionReport(
      report({ clientOrderId: 'a', status: 'PARTIALLY_FILLED', lastFilledQty: 2, lastFilledPriceTicks: 9999, remainingQty: 3, transactTimeNs: 7 }),
    );
    expect(h.fills.length).toBe(1);
    expect(h.fills[0]).toMatchObject({
      timestampNs: 7,
      side: SIDE_BID,
      priceTicks: 9999,
      size: 2,
      queuePositionAtFill: 20,
      midTicksAtFill: 10000,
      liquidity: LIQ_MAKER,
    });
    expect(h.gw.position()).toBe(2);
    expect(h.gw.openOrders()[0].remaining).toBe(3);
  });

  it('retires a fully filled order and keeps the position', () => {
    const h = synced();
    h.gw.submit(order('a', SIDE_ASK, 10001, 4));
    h.gw.onExecutionReport(report({ clientOrderId: 'a', status: 'NEW' }));
    h.gw.onExecutionReport(
      report({ clientOrderId: 'a', status: 'FILLED', lastFilledQty: 4, lastFilledPriceTicks: 10001, remainingQty: 0, isMaker: false }),
    );
    expect(h.gw.openOrders()).toEqual([]);
    expect(h.gw.position()).toBe(-4);
    expect(h.fills[0].liquidity).toBe(LIQ_TAKER);
  });

  it('retires a canceled order and reports an exchange rejection', () => {
    const h = synced();
    h.gw.submit(order('a', SIDE_BID, 9999, 5));
    h.gw.onExecutionReport(report({ clientOrderId: 'a', status: 'CANCELED' }));
    expect(h.gw.openOrders()).toEqual([]);

    h.gw.submit(order('b', SIDE_BID, 9999, 5));
    h.gw.onExecutionReport(report({ clientOrderId: 'b', status: 'REJECTED' }));
    expect(h.rejects).toEqual(['b']);
    expect(h.gw.openOrders()).toEqual([]);
  });

  it('ignores an execution report for an order it never sent', () => {
    const h = synced();
    h.gw.onExecutionReport(report({ clientOrderId: 'ghost', status: 'FILLED', lastFilledQty: 9 }));
    expect(h.fills).toEqual([]);
    expect(h.gw.position()).toBe(0);
  });

  it('maps a buyer-is-maker trade onto the bid queue and the reverse onto the ask queue', () => {
    const h = synced();
    h.gw.submit(order('a', SIDE_ASK, 10001, 5));
    h.gw.onExecutionReport(report({ clientOrderId: 'a', status: 'NEW' }));
    h.gw.onTrade(2, 10001, 15, false);
    h.gw.onExecutionReport(
      report({ clientOrderId: 'a', status: 'PARTIALLY_FILLED', lastFilledQty: 1, lastFilledPriceTicks: 10001, remainingQty: 4 }),
    );
    expect(h.fills[0].queuePositionAtFill).toBe(25);
  });
});
