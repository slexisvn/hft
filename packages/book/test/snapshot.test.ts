import { describe, expect, it } from 'vitest';
import { EV_NEW_LIMIT_ORDER, EV_TOTAL_DELETE, NO_PRICE, SIDE_ASK, SIDE_BID } from '@hft/contracts';
import { L3Book, SnapshotWriter } from '@hft/book';

function book(): L3Book {
  const b = new L3Book({ minPriceTicks: 0, maxPriceTicks: 200, initialOrderCapacity: 16 });
  b.apply(1, EV_NEW_LIMIT_ORDER, 1, SIDE_BID, 100, 50);
  b.apply(2, EV_NEW_LIMIT_ORDER, 2, SIDE_BID, 100, 25);
  b.apply(3, EV_NEW_LIMIT_ORDER, 3, SIDE_BID, 98, 10);
  b.apply(4, EV_NEW_LIMIT_ORDER, 4, SIDE_ASK, 102, 40);
  b.apply(5, EV_NEW_LIMIT_ORDER, 5, SIDE_ASK, 105, 60);
  return b;
}

describe('L2 snapshot from an L3 book', () => {
  it('aggregates each level and skips empty ticks', () => {
    const s = new SnapshotWriter(3).capture(book());
    expect(Array.from(s.bidPriceTicks)).toEqual([100, 98, NO_PRICE]);
    expect(Array.from(s.bidSize)).toEqual([75, 10, 0]);
    expect(Array.from(s.askPriceTicks)).toEqual([102, 105, NO_PRICE]);
    expect(Array.from(s.askSize)).toEqual([40, 60, 0]);
    expect(s.timestampNs).toBe(5);
  });

  it('pads with NO_PRICE when the book is thinner than the requested depth', () => {
    const b = new L3Book({ minPriceTicks: 0, maxPriceTicks: 200, initialOrderCapacity: 16 });
    b.apply(1, EV_NEW_LIMIT_ORDER, 1, SIDE_BID, 100, 5);
    const s = new SnapshotWriter(2).capture(b);
    expect(Array.from(s.bidPriceTicks)).toEqual([100, NO_PRICE]);
    expect(Array.from(s.askPriceTicks)).toEqual([NO_PRICE, NO_PRICE]);
    expect(Array.from(s.askSize)).toEqual([0, 0]);
  });

  it('is reusable and reflects the book after every apply', () => {
    const b = book();
    const w = new SnapshotWriter(2);
    w.capture(b);
    b.apply(6, EV_TOTAL_DELETE, 4, SIDE_ASK, 102, 40);
    const s = w.capture(b);
    expect(s.askPriceTicks[0]).toBe(105);
    expect(s.askSize[0]).toBe(60);
  });
});

describe('derived quote statistics', () => {
  it('reports mid, spread and a size-weighted micro price', () => {
    const b = book();
    expect(b.bestBidTicks()).toBe(100);
    expect(b.bestAskTicks()).toBe(102);
    expect(b.midTicks()).toBe(101);
    expect(b.spreadTicks()).toBe(2);
    expect(b.microPriceTicks()).toBeCloseTo((100 * 40 + 102 * 75) / 115, 12);
  });

  it('returns NaN rather than inventing a mid when one side is empty', () => {
    const b = new L3Book({ minPriceTicks: 0, maxPriceTicks: 200, initialOrderCapacity: 4 });
    b.apply(1, EV_NEW_LIMIT_ORDER, 1, SIDE_BID, 100, 5);
    expect(b.isEmpty(SIDE_ASK)).toBe(true);
    expect(Number.isNaN(b.midTicks())).toBe(true);
    expect(Number.isNaN(b.spreadTicks())).toBe(true);
    expect(Number.isNaN(b.microPriceTicks())).toBe(true);
  });
});
