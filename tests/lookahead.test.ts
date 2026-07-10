import { describe, expect, it } from 'vitest';
import { SIDE_BID, type BookView, type Strategy, type StrategyContext } from '@hft/contracts';
import { SimEngine } from '@hft/sim';
import { buildEvents } from './helpers';

const MD_LATENCY_NS = 5_000_000;

class Recorder implements Strategy {
  readonly name = 'recorder';
  readonly observations: { clockNs: number; viewTs: number; bestBid: number }[] = [];

  onStart(): void {}
  onMarketData(ctx: StrategyContext, view: BookView): void {
    this.observations.push({ clockNs: ctx.clock.now(), viewTs: view.timestampNs, bestBid: view.bestBidTicks() });
  }
  onFill(): void {}
  onOrderRejected(): void {}
  onStop(): void {}
}

describe('look-ahead bias is structurally impossible', () => {
  it('the strategy only ever sees a book stamped market-data-latency in the past', () => {
    const strategy = new Recorder();
    const engine = new SimEngine(
      {
        minPriceTicks: 900,
        maxPriceTicks: 1100,
        initialOrderCapacity: 64,
        snapshotDepth: 5,
        marketDataLatencyNs: MD_LATENCY_NS,
        decisionLatencyNs: 1_000_000,
        orderEntryLatencyNs: 1_000_000,
        makerFeeBps: 0,
        takerFeeBps: 0,
      inventorySampleIntervalNs: 1000000,
      },
      strategy,
    );
    engine.run(buildEvents());

    expect(strategy.observations.length).toBeGreaterThan(0);
    for (const o of strategy.observations) {
      expect(o.clockNs - o.viewTs).toBe(MD_LATENCY_NS);
    }
  });

  it('a book change after the decision is not visible to the decision', () => {
    const seen: number[] = [];
    class Watcher implements Strategy {
      readonly name = 'watcher';
      onStart(): void {}
      onMarketData(_ctx: StrategyContext, view: BookView): void {
        const bid = view.bestBidTicks();
        seen.push(bid === -1 ? -1 : view.sizeAt(SIDE_BID, bid));
      }
      onFill(): void {}
      onOrderRejected(): void {}
      onStop(): void {}
    }

    const engine = new SimEngine(
      {
        minPriceTicks: 900,
        maxPriceTicks: 1100,
        initialOrderCapacity: 64,
        snapshotDepth: 5,
        marketDataLatencyNs: 25_000_000,
        decisionLatencyNs: 0,
        orderEntryLatencyNs: 0,
        makerFeeBps: 0,
        takerFeeBps: 0,
      inventorySampleIntervalNs: 1000000,
      },
      new Watcher(),
    );
    engine.run(buildEvents());

    expect(seen[0]).toBe(100);
    expect(seen).not.toContain(0);
  });
});
