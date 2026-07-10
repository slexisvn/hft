import { describe, expect, it } from 'vitest';
import {
  EV_EXECUTE_HIDDEN,
  EV_EXECUTE_VISIBLE,
  EV_NEW_LIMIT_ORDER,
  EV_PARTIAL_CANCEL,
  LIQ_MAKER,
  LIQ_TAKER,
  SIDE_ASK,
  SIDE_BID,
  type BookView,
  type FillRecord,
  type Strategy,
  type StrategyContext,
} from '@hft/contracts';
import { EventBuffer } from '@hft/events';
import { SimClock, SimEngine } from '@hft/sim';

const OPTS = {
  minPriceTicks: 900,
  maxPriceTicks: 1100,
  initialOrderCapacity: 64,
  snapshotDepth: 5,
  marketDataLatencyNs: 0,
  decisionLatencyNs: 0,
  orderEntryLatencyNs: 0,
  makerFeeBps: 0,
  takerFeeBps: 0,
      inventorySampleIntervalNs: 1000000,
};

class OneShot implements Strategy {
  readonly name = 'one_shot';
  private placed = false;
  readonly fills: FillRecord[] = [];

  constructor(
    private readonly side: 0 | 1,
    private readonly priceTicks: number,
    private readonly size: number,
    private readonly postOnly = true,
  ) {}

  onStart(): void {}
  onMarketData(ctx: StrategyContext, view: BookView): void {
    if (this.placed || view.bestBidTicks() < 0 || view.bestAskTicks() < 0) return;
    this.placed = true;
    ctx.gateway.submit({
      clientOrderId: 'q1',
      side: this.side,
      priceTicks: this.priceTicks,
      size: this.size,
      postOnly: this.postOnly,
    });
  }
  onFill(_ctx: StrategyContext, fill: FillRecord): void {
    this.fills.push(fill);
  }
  onOrderRejected(_ctx: StrategyContext, _clientOrderId: string, _reason: string): void {}
  onStop(): void {}
}

function base(): EventBuffer {
  const b = new EventBuffer(32);
  b.push(0, EV_NEW_LIMIT_ORDER, SIDE_BID, 1, 100, 1000);
  b.push(1, EV_NEW_LIMIT_ORDER, SIDE_ASK, 2, 100, 1002);
  return b;
}

describe('maker fills respect queue priority', () => {
  it('does not fill while size rests ahead of us', () => {
    const events = base();
    events.push(1_000_000, EV_EXECUTE_VISIBLE, SIDE_BID, 1, 60, 1000);
    const strategy = new OneShot(SIDE_BID, 1000, 10);
    new SimEngine(OPTS, strategy).run(events);
    expect(strategy.fills).toEqual([]);
  });

  it('fills only the overflow once the queue ahead is consumed', () => {
    const events = base();
    events.push(1_000_000, EV_EXECUTE_VISIBLE, SIDE_BID, 1, 104, 1000);
    const strategy = new OneShot(SIDE_BID, 1000, 10);
    new SimEngine(OPTS, strategy).run(events);
    expect(strategy.fills.length).toBe(1);
    expect(strategy.fills[0].size).toBe(4);
    expect(strategy.fills[0].queuePositionAtFill).toBe(100);
    expect(strategy.fills[0].liquidity).toBe(LIQ_MAKER);
  });

  it('counts a cancel ahead of us as queue progress', () => {
    const events = base();
    events.push(1_000_000, EV_PARTIAL_CANCEL, SIDE_BID, 1, 60, 1000);
    events.push(2_000_000, EV_EXECUTE_VISIBLE, SIDE_BID, 1, 45, 1000);
    const strategy = new OneShot(SIDE_BID, 1000, 10);
    new SimEngine(OPTS, strategy).run(events);
    expect(strategy.fills.length).toBe(1);
    expect(strategy.fills[0].size).toBe(5);
    expect(strategy.fills[0].queuePositionAtFill).toBe(40);
  });

  it('ignores size that joined the queue behind us', () => {
    const events = base();
    events.push(1_000_000, EV_NEW_LIMIT_ORDER, SIDE_BID, 3, 50, 1000);
    events.push(2_000_000, EV_EXECUTE_VISIBLE, SIDE_BID, 1, 100, 1000);
    events.push(3_000_000, EV_EXECUTE_VISIBLE, SIDE_BID, 3, 55, 1000);
    const strategy = new OneShot(SIDE_BID, 1000, 10);
    new SimEngine(OPTS, strategy).run(events);
    expect(strategy.fills.length).toBe(1);
    expect(strategy.fills[0].size).toBe(10);
    expect(strategy.fills[0].queuePositionAtFill).toBe(0);
  });
});

describe('hidden executions', () => {
  it('are trades on the tape but never fill a resting order', () => {
    const events = base();
    events.push(1_000_000, EV_EXECUTE_HIDDEN, SIDE_BID, 0, 500, 1000);
    const strategy = new OneShot(SIDE_BID, 1000, 10);
    const result = new SimEngine(OPTS, strategy).run(events);
    expect(strategy.fills).toEqual([]);
    expect(result.trades.timestampNs.length).toBe(1);
    expect(result.trades.hidden[0]).toBe(1);
  });
});

describe('marketable orders', () => {
  it('are rejected when post-only would cross', () => {
    const rejects: string[] = [];
    class PostOnlyCrosser extends OneShot {
      override onOrderRejected(_ctx: StrategyContext, clientOrderId: string, reason: string): void {
        rejects.push(`${clientOrderId}:${reason}`);
      }
    }
    const strategy = new PostOnlyCrosser(SIDE_BID, 1002, 10, true);
    new SimEngine(OPTS, strategy).run(base());
    expect(rejects).toEqual(['q1:post_only_would_cross']);
    expect(strategy.fills).toEqual([]);
  });

  it('cross the spread and pay the taker side when post-only is off', () => {
    const strategy = new OneShot(SIDE_BID, 1002, 10, false);
    new SimEngine(OPTS, strategy).run(base());
    expect(strategy.fills.length).toBe(1);
    expect(strategy.fills[0].liquidity).toBe(LIQ_TAKER);
    expect(strategy.fills[0].priceTicks).toBe(1002);
    expect(strategy.fills[0].queuePositionAtFill).toBe(0);
  });
});

describe('SimClock', () => {
  it('pops timers in time order and breaks ties by scheduling order', () => {
    const clock = new SimClock();
    const seen: string[] = [];
    clock.schedule(100, () => seen.push('b'));
    clock.schedule(100, () => seen.push('c'));
    clock.schedule(50, () => seen.push('a'));
    while (clock.runNext());
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(clock.now()).toBe(100);
  });

  it('refuses to schedule in the past and to move backwards', () => {
    const clock = new SimClock();
    clock.schedule(10, () => undefined);
    clock.runNext();
    expect(() => clock.schedule(5, () => undefined)).toThrowError(/cannot schedule/);
    expect(() => clock.advanceTo(5)).toThrowError(/cannot move backwards/);
  });

  it('skips canceled timers', () => {
    const clock = new SimClock();
    const seen: string[] = [];
    const id = clock.schedule(10, () => seen.push('x'));
    clock.schedule(20, () => seen.push('y'));
    clock.cancelTimer(id);
    while (clock.runNext());
    expect(seen).toEqual(['y']);
  });
});
