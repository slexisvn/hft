import { describe, expect, it } from 'vitest';
import { compareFills, type CompareFill } from '@hft/metrics';

function f(clientOrderId: string, size: number, priceTicks: number, queue: number): CompareFill {
  return { clientOrderId, size, priceTicks, queuePositionAtFill: queue };
}

describe('compareFills', () => {
  it('matches orders by client_order_id and measures queue and vwap drift', () => {
    const sim = [f('a', 10, 100, 5), f('b', 10, 101, 0)];
    const live = [f('a', 10, 102, 9), f('c', 10, 100, 0)];
    const r = compareFills(sim, live);
    expect(r.matchedOrders).toBe(1);
    expect(r.simOnlyOrders).toBe(1);
    expect(r.liveOnlyOrders).toBe(1);
    expect(r.meanAbsQueueDelta).toBe(4);
    expect(r.meanAbsVwapDeltaTicks).toBe(2);
  });

  it('aggregates partial fills of one order before comparing', () => {
    const sim = [f('a', 4, 100, 3), f('a', 6, 110, 3)];
    const live = [f('a', 10, 106, 3)];
    const r = compareFills(sim, live);
    expect(r.matchedOrders).toBe(1);
    expect(r.simFilledSize).toBe(10);
    expect(r.liveFilledSize).toBe(10);
    expect(r.meanAbsVwapDeltaTicks).toBe(0);
  });

  it('reports zeros for empty inputs', () => {
    const r = compareFills([], []);
    expect(r).toMatchObject({ matchedOrders: 0, simOnlyOrders: 0, liveOnlyOrders: 0, meanAbsQueueDelta: 0 });
  });
});
