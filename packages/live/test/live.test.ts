import { describe, expect, it } from 'vitest';
import {
  KillSwitchError,
  OrderStateError,
  SIDE_ASK,
  SIDE_BID,
  SequenceGapError,
  type BookView,
  type Gateway,
  type OrderRequest,
  type OrderSnapshot,
} from '@hft/contracts';
import {
  ClientOrderIdGenerator,
  IdempotentSubmitter,
  KillSwitch,
  OrderRegistry,
  OrderStateMachine,
  RealClock,
  SequenceTracker,
  TokenBucket,
  canTransition,
  reconcile,
} from '@hft/live';

class FakeClock {
  private t = 0;
  now(): number {
    return this.t;
  }
  advance(ns: number): void {
    this.t += ns;
  }
}

class FakeGateway implements Gateway {
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

describe('order state machine', () => {
  it('walks the happy path', () => {
    const fsm = new OrderStateMachine('a');
    expect(fsm.state).toBe('pending');
    fsm.transition('acked');
    fsm.transition('partial');
    fsm.transition('filled');
    expect(fsm.state).toBe('filled');
  });

  it('throws on an illegal transition', () => {
    const fsm = new OrderStateMachine('a');
    fsm.transition('acked');
    fsm.transition('filled');
    expect(() => fsm.transition('canceled')).toThrowError(OrderStateError);
    expect(() => fsm.transition('partial')).toThrowError(/illegal transition filled -> partial/);
  });

  it('refuses to resurrect a rejected order', () => {
    const fsm = new OrderStateMachine('a');
    fsm.transition('rejected');
    expect(() => fsm.transition('acked')).toThrowError(OrderStateError);
    expect(canTransition('rejected', 'acked')).toBe(false);
  });

  it('rejects duplicate registration and unknown lookups', () => {
    const reg = new OrderRegistry();
    reg.create('a');
    expect(() => reg.create('a')).toThrowError(/already registered/);
    expect(() => reg.get('b')).toThrowError(/unknown order/);
    reg.transition('a', 'acked');
    expect(reg.liveOrderIds()).toEqual(['a']);
    reg.transition('a', 'filled');
    expect(reg.liveOrderIds()).toEqual([]);
  });
});

describe('client order ids', () => {
  it('are deterministic for a given prefix, epoch and sequence', () => {
    const a = new ClientOrderIdGenerator('mm', 7);
    const b = new ClientOrderIdGenerator('mm', 7);
    expect(a.next(SIDE_BID)).toBe(b.next(SIDE_BID));
    expect(a.next(SIDE_ASK)).toBe('mm.7.1.1');
  });

  it('a reconnect that replays the same sequence does not place a duplicate order', () => {
    const gateway = new FakeGateway();
    const submitter = new IdempotentSubmitter(gateway);
    const gen = new ClientOrderIdGenerator('mm', 7);

    const id = gen.next(SIDE_BID);
    expect(submitter.submit(req(id))).toBe(true);

    const reconnected = new ClientOrderIdGenerator('mm', 7);
    const replayed = reconnected.next(SIDE_BID);
    expect(replayed).toBe(id);
    expect(submitter.submit(req(replayed))).toBe(false);
    expect(gateway.submitted.length).toBe(1);
  });

  it('refuses to rewind its sequence', () => {
    const gen = new ClientOrderIdGenerator('mm', 7);
    gen.next(SIDE_BID);
    gen.next(SIDE_BID);
    expect(() => gen.restore(1)).toThrowError(/cannot rewind/);
    gen.restore(5);
    expect(gen.next(SIDE_BID)).toBe('mm.7.0.5');
  });
});

describe('sequence tracker', () => {
  it('accepts a contiguous stream and flags duplicates', () => {
    const t = new SequenceTracker(true);
    expect(t.accept(10)).toBe('ok');
    expect(t.accept(11)).toBe('ok');
    expect(t.accept(10)).toBe('duplicate');
  });

  it('reports a gap for resync instead of silently skipping', () => {
    const t = new SequenceTracker(true);
    t.accept(1);
    expect(t.accept(5)).toBe('gap');
    expect(t.gapCount).toBe(1);
  });

  it('throws when configured not to resync', () => {
    const t = new SequenceTracker(false);
    t.accept(1);
    expect(() => t.accept(5)).toThrowError(SequenceGapError);
  });
});

describe('token bucket', () => {
  it('drains and refills against the injected clock', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(2, 1, clock);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(true);
    expect(bucket.tryAcquire()).toBe(false);
    expect(bucket.nanosUntilAvailable()).toBe(1_000_000_000);
    clock.advance(1_000_000_000);
    expect(bucket.tryAcquire()).toBe(true);
  });

  it('never exceeds capacity', () => {
    const clock = new FakeClock();
    const bucket = new TokenBucket(2, 100, clock);
    clock.advance(10_000_000_000);
    expect(bucket.tryAcquire(2)).toBe(true);
    expect(bucket.tryAcquire(1)).toBe(false);
  });
});

describe('reconcile', () => {
  const order: OrderSnapshot = {
    clientOrderId: 'a',
    side: SIDE_BID,
    priceTicks: 100,
    size: 5,
    remaining: 5,
    state: 'acked',
  };

  it('is clean when both sides agree', () => {
    const r = reconcile({ position: 3, openOrders: [order] }, { position: 3, openOrders: [order] }, 0);
    expect(r.breach).toBe(false);
    expect(r.positionDrift).toBe(0);
  });

  it('detects position drift beyond tolerance', () => {
    const r = reconcile({ position: 3, openOrders: [] }, { position: 1, openOrders: [] }, 1);
    expect(r.positionDrift).toBe(2);
    expect(r.breach).toBe(true);
  });

  it('detects orders known locally but absent at the exchange, and the reverse', () => {
    const r = reconcile({ position: 0, openOrders: [order] }, { position: 0, openOrders: [] }, 0);
    expect(r.missingRemotely).toEqual(['a']);
    const r2 = reconcile({ position: 0, openOrders: [] }, { position: 0, openOrders: [order] }, 0);
    expect(r2.missingLocally).toEqual(['a']);
  });

  it('detects a price mismatch on the same client order id', () => {
    const remote = { ...order, priceTicks: 101 };
    const r = reconcile({ position: 0, openOrders: [order] }, { position: 0, openOrders: [remote] }, 0);
    expect(r.priceMismatches).toEqual(['a']);
    expect(r.breach).toBe(true);
  });
});

describe('kill switch', () => {
  function make(limits: Partial<Record<string, number>> = {}): { ks: KillSwitch; gw: FakeGateway; clock: FakeClock } {
    const clock = new FakeClock();
    const gw = new FakeGateway();
    gw.submit(req('x'));
    gw.submit(req('y'));
    const ks = new KillSwitch(
      {
        maxPosition: (limits.maxPosition as number) ?? 10,
        maxLossTicks: (limits.maxLossTicks as number) ?? 100,
        maxOrdersPerSecond: (limits.maxOrdersPerSecond as number) ?? 3,
        maxReconcileDrift: (limits.maxReconcileDrift as number) ?? 0,
      },
      clock,
      gw,
    );
    return { ks, gw, clock };
  }

  it('trips on max position and cancels every open order', () => {
    const { ks, gw } = make();
    expect(() => ks.onPosition(11)).toThrowError(KillSwitchError);
    expect(ks.tripped).toBe(true);
    expect(ks.reason).toBe('max_position');
    expect(gw.canceled.sort()).toEqual(['x', 'y']);
    expect(gw.openOrders().length).toBe(0);
  });

  it('trips on max loss', () => {
    const { ks } = make();
    ks.onPnlTicks(-99);
    expect(() => ks.onPnlTicks(-101)).toThrowError(/max_loss/);
  });

  it('trips on max order rate within a one second window', () => {
    const { ks } = make();
    ks.onOrderSubmitted();
    ks.onOrderSubmitted();
    ks.onOrderSubmitted();
    expect(() => ks.onOrderSubmitted()).toThrowError(/max_order_rate/);
  });

  it('does not trip on order rate once the window rolls', () => {
    const { ks, clock } = make();
    ks.onOrderSubmitted();
    ks.onOrderSubmitted();
    ks.onOrderSubmitted();
    clock.advance(1_000_000_000);
    expect(() => ks.onOrderSubmitted()).not.toThrow();
  });

  it('trips on reconcile drift', () => {
    const { ks } = make();
    expect(() => ks.onReconcileDrift(1)).toThrowError(/reconcile_drift/);
  });

  it('stays tripped and keeps refusing new orders', () => {
    const { ks } = make();
    expect(() => ks.halt()).toThrowError(/manual/);
    expect(() => ks.onOrderSubmitted()).toThrowError(/manual/);
  });
});

describe('real clock', () => {
  it('reports nanoseconds since UTC midnight and advances monotonically', () => {
    const clock = new RealClock(Date.UTC(2026, 6, 10, 1, 0, 0, 0), 0);
    const t = clock.now();
    expect(t).toBeGreaterThanOrEqual(3600 * 1_000_000_000);
    expect(clock.now()).toBeGreaterThanOrEqual(t);
  });
});
