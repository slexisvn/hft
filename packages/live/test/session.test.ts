import { describe, expect, it } from 'vitest';
import {
  SIDE_BID,
  type BookView,
  type Gateway,
  type OrderRequest,
  type OrderSnapshot,
  type SchedulingClock,
  type TimerId,
} from '@hft/contracts';
import {
  GuardedGateway,
  KillSwitch,
  LiveSession,
  OrderRegistry,
  TokenBucket,
  type AccountSnapshot,
  type ReconcileResult,
  type RejectReason,
} from '@hft/live';

class TestClock implements SchedulingClock {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; cb: () => void }>();

  now(): number {
    return this.t;
  }
  schedule(atNs: number, callback: () => void): TimerId {
    const id = this.seq++;
    this.timers.set(id, { at: atNs, cb: callback });
    return id;
  }
  cancelTimer(id: TimerId): void {
    this.timers.delete(id);
  }
  advanceTo(t: number): void {
    for (;;) {
      let next: [number, { at: number; cb: () => void }] | null = null;
      for (const entry of this.timers) {
        if (entry[1].at <= t && (next === null || entry[1].at < next[1].at)) next = entry;
      }
      if (next === null) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].cb();
    }
    this.t = t;
  }
}

class InnerGateway implements Gateway {
  readonly submitted: OrderRequest[] = [];
  readonly canceled: string[] = [];
  open: OrderSnapshot[] = [];
  pos = 0;

  submit(request: OrderRequest): void {
    this.submitted.push(request);
    this.open.push({
      clientOrderId: request.clientOrderId,
      side: request.side,
      priceTicks: request.priceTicks,
      size: request.size,
      remaining: request.size,
      state: 'acked',
    });
  }
  cancel(clientOrderId: string): void {
    this.canceled.push(clientOrderId);
    this.open = this.open.filter((o) => o.clientOrderId !== clientOrderId);
  }
  amend(): void {}
  openOrders(): readonly OrderSnapshot[] {
    return this.open;
  }
  position(): number {
    return this.pos;
  }
  marketView(): BookView {
    throw new Error('not used');
  }
}

function req(id: string): OrderRequest {
  return { clientOrderId: id, side: SIDE_BID, priceTicks: 100, size: 1, postOnly: true };
}

interface Harness {
  clock: TestClock;
  inner: InnerGateway;
  guarded: GuardedGateway;
  rejects: { id: string; reason: RejectReason }[];
  halts: string[];
}

function harness(limits?: { maxOrdersPerSecond?: number; maxPosition?: number; capacity?: number }): Harness {
  const clock = new TestClock();
  const inner = new InnerGateway();
  const rejects: { id: string; reason: RejectReason }[] = [];
  const halts: string[] = [];
  const bucket = new TokenBucket(limits?.capacity ?? 100, 1, clock);
  const killSwitch = new KillSwitch(
    {
      maxPosition: limits?.maxPosition ?? 100,
      maxLossTicks: 1000,
      maxOrdersPerSecond: limits?.maxOrdersPerSecond ?? 100,
      maxReconcileDrift: 0,
    },
    clock,
    inner,
  );
  const guarded = new GuardedGateway(inner, bucket, killSwitch, new OrderRegistry(), {
    onOrderRejected: (id, reason) => rejects.push({ id, reason }),
    onHalted: (reason) => halts.push(reason),
  });
  return { clock, inner, guarded, rejects, halts };
}

describe('GuardedGateway sits on the order path', () => {
  it('passes a normal order through and registers its state machine', () => {
    const h = harness();
    h.guarded.submit(req('a'));
    expect(h.inner.submitted.length).toBe(1);
    expect(h.guarded.orders.liveOrderIds()).toEqual(['a']);
  });

  it('rejects a duplicate client order id instead of double-placing', () => {
    const h = harness();
    h.guarded.submit(req('a'));
    h.guarded.submit(req('a'));
    expect(h.inner.submitted.length).toBe(1);
    expect(h.rejects).toEqual([{ id: 'a', reason: 'duplicate_client_order_id' }]);
  });

  it('rejects once the token bucket is empty rather than flooding the exchange', () => {
    const h = harness({ capacity: 2 });
    h.guarded.submit(req('a'));
    h.guarded.submit(req('b'));
    h.guarded.submit(req('c'));
    expect(h.inner.submitted.length).toBe(2);
    expect(h.rejects).toEqual([{ id: 'c', reason: 'rate_limited' }]);
  });

  it('halts on the order rate limit, cancels every open order, and refuses later orders', () => {
    const h = harness({ maxOrdersPerSecond: 2 });
    h.guarded.submit(req('a'));
    h.guarded.submit(req('b'));
    h.guarded.submit(req('c'));
    expect(h.halts).toEqual(['max_order_rate']);
    expect(h.guarded.isHalted).toBe(true);
    expect(h.inner.canceled.sort()).toEqual(['a', 'b']);

    h.guarded.submit(req('d'));
    expect(h.rejects[h.rejects.length - 1]).toEqual({ id: 'd', reason: 'halted' });
    expect(h.inner.submitted.map((o) => o.clientOrderId)).toEqual(['a', 'b']);
  });

  it('halts when a fill pushes the position past the limit', () => {
    const h = harness({ maxPosition: 5 });
    h.guarded.submit(req('a'));
    h.guarded.onAck('a');
    h.inner.pos = 6;
    h.guarded.onFill('a', 0);
    expect(h.halts).toEqual(['max_position']);
  });

  it('does not cancel an order it never registered', () => {
    const h = harness();
    h.guarded.cancel('ghost');
    expect(h.inner.canceled).toEqual([]);
  });

  it('reloads open orders from the exchange so it can cancel and dedupe them after a restart', () => {
    const h = harness();
    h.guarded.restoreOpenOrders([
      { clientOrderId: 'prev-1', side: SIDE_BID, priceTicks: 100, size: 1, remaining: 1, state: 'acked' },
    ]);
    expect(h.guarded.orders.liveOrderIds()).toEqual(['prev-1']);
    h.guarded.cancel('prev-1');
    expect(h.inner.canceled).toEqual(['prev-1']);
    h.guarded.submit(req('prev-1'));
    expect(h.rejects).toEqual([{ id: 'prev-1', reason: 'duplicate_client_order_id' }]);
  });
});

describe('LiveSession reconciles on a cycle', () => {
  function session(remote: () => AccountSnapshot, tolerance = 0): {
    h: Harness;
    s: LiveSession;
    results: ReconcileResult[];
    resyncs: number[];
  } {
    const h = harness();
    const results: ReconcileResult[] = [];
    const resyncs: number[] = [];
    const s = new LiveSession(
      h.clock,
      h.guarded,
      { reconcileIntervalNs: 1_000_000_000, reconcileToleranceQty: tolerance, resyncOnSequenceGap: true },
      {
        fetchExchangeAccount: remote,
        resyncOrderBookSnapshot: () => resyncs.push(1),
        onReconcile: (r) => results.push(r),
      },
    );
    return { h, s, results, resyncs };
  }

  it('reconciles repeatedly on the configured interval', () => {
    const { h, s, results } = session(() => ({ position: 0, openOrders: h.inner.openOrders() }));
    s.start();
    h.clock.advanceTo(3_500_000_000);
    expect(results.length).toBe(3);
    expect(s.reconcileCount).toBe(3);
    expect(results.every((r) => !r.breach)).toBe(true);
  });

  it('trips the kill switch when the exchange position disagrees beyond tolerance', () => {
    const { h, s } = session(() => ({ position: 7, openOrders: h.inner.openOrders() }));
    s.start();
    h.clock.advanceTo(1_000_000_000);
    expect(h.halts).toEqual(['reconcile_drift']);
    expect(s.isRunning).toBe(false);
  });

  it('halts when the exchange reports an order we never placed', () => {
    const { h, s } = session(() => ({
      position: 0,
      openOrders: [{ clientOrderId: 'ghost', side: SIDE_BID, priceTicks: 100, size: 1, remaining: 1, state: 'acked' }],
    }));
    s.start();
    h.clock.advanceTo(1_000_000_000);
    expect(h.halts).toEqual(['manual']);
  });

  it('stops rescheduling once halted', () => {
    const { h, s, results } = session(() => ({ position: 7, openOrders: h.inner.openOrders() }));
    s.start();
    h.clock.advanceTo(5_000_000_000);
    expect(results.length).toBe(1);
  });

  it('trips max_loss when mark-to-market PnL breaches the loss limit on a reconcile', () => {
    const h = harness();
    let pnl = 0;
    const s = new LiveSession(
      h.clock,
      h.guarded,
      { reconcileIntervalNs: 1_000_000_000, reconcileToleranceQty: 0, resyncOnSequenceGap: true },
      {
        fetchExchangeAccount: () => ({ position: 0, openOrders: h.inner.openOrders() }),
        resyncOrderBookSnapshot: () => undefined,
        onReconcile: () => undefined,
        markToMarketPnlTicks: () => pnl,
      },
    );
    h.guarded.submit(req('a'));
    s.start();
    pnl = -2000;
    h.clock.advanceTo(1_000_000_000);
    expect(h.halts).toEqual(['max_loss']);
    expect(h.inner.canceled).toContain('a');
    expect(s.isRunning).toBe(false);
  });
});

describe('LiveSession sequence handling', () => {
  function session(): { s: LiveSession; resyncs: number[]; h: Harness } {
    const h = harness();
    const resyncs: number[] = [];
    const s = new LiveSession(
      h.clock,
      h.guarded,
      { reconcileIntervalNs: 1_000_000_000, reconcileToleranceQty: 0, resyncOnSequenceGap: true },
      {
        fetchExchangeAccount: () => ({ position: 0, openOrders: [] }),
        resyncOrderBookSnapshot: () => resyncs.push(1),
        onReconcile: () => undefined,
      },
    );
    return { s, resyncs, h };
  }

  it('never silently skips a gap: it resyncs the snapshot', () => {
    const { s, resyncs } = session();
    expect(s.onSequence(10)).toBe('ok');
    expect(s.onSequence(11)).toBe('ok');
    expect(s.onSequence(20)).toBe('gap');
    expect(resyncs.length).toBe(1);
    expect(s.resyncCount).toBe(1);
    expect(s.onSequence(21)).toBe('ok');
  });

  it('ignores duplicates without resyncing', () => {
    const { s, resyncs } = session();
    s.onSequence(10);
    expect(s.onSequence(10)).toBe('duplicate');
    expect(resyncs.length).toBe(0);
  });
});
