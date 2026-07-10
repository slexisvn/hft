import { describe, expect, it } from 'vitest';
import {
  EV_EXECUTE_VISIBLE,
  EV_NEW_LIMIT_ORDER,
  EV_PARTIAL_CANCEL,
  EV_TOTAL_DELETE,
  NO_PRICE,
  SIDE_ASK,
  SIDE_BID,
  type Side,
} from '@hft/contracts';
import { L3Book, checkInvariants, fillFromExecution } from '@hft/book';

function xorshift32(seed: number): () => number {
  let s = seed | 0;
  if (s === 0) s = 0x1234abcd;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Live {
  id: number;
  side: Side;
  ticks: number;
  size: number;
}

describe('L3Book invariants under seeded random event streams', () => {
  it('holds after every event', () => {
    const rnd = xorshift32(20260710);
    const book = new L3Book({ minPriceTicks: 900, maxPriceTicks: 1100, initialOrderCapacity: 8 });
    const live: Live[] = [];
    let nextId = 1;
    let ts = 0;

    for (let step = 0; step < 20000; step++) {
      ts += 1000;
      const action = rnd();
      if (live.length === 0 || action < 0.5) {
        const side: Side = rnd() < 0.5 ? SIDE_BID : SIDE_ASK;
        const bid = book.bestBidTicks();
        const ask = book.bestAskTicks();
        let ticks: number;
        if (side === SIDE_BID) {
          const cap = ask === NO_PRICE ? 1050 : ask - 1;
          ticks = cap - Math.floor(rnd() * 5);
        } else {
          const floorT = bid === NO_PRICE ? 950 : bid + 1;
          ticks = floorT + Math.floor(rnd() * 5);
        }
        if (ticks < 901 || ticks > 1099) continue;
        const size = 1 + Math.floor(rnd() * 100);
        const id = nextId++;
        book.apply(ts, EV_NEW_LIMIT_ORDER, id, side, ticks, size);
        live.push({ id, side, ticks, size });
      } else {
        const idx = Math.floor(rnd() * live.length);
        const o = live[idx];
        const pick = rnd();
        if (pick < 0.35 && o.size > 1) {
          const delta = 1 + Math.floor(rnd() * (o.size - 1));
          book.apply(ts, EV_PARTIAL_CANCEL, o.id, o.side, o.ticks, delta);
          o.size -= delta;
        } else if (pick < 0.7) {
          book.apply(ts, EV_TOTAL_DELETE, o.id, o.side, o.ticks, o.size);
          live.splice(idx, 1);
        } else {
          const isBest = o.side === SIDE_BID ? o.ticks === book.bestBidTicks() : o.ticks === book.bestAskTicks();
          if (!isBest) continue;
          const exec = 1 + Math.floor(rnd() * o.size);
          book.apply(ts, EV_EXECUTE_VISIBLE, o.id, o.side, o.ticks, exec);
          o.size -= exec;
          if (o.size === 0) live.splice(idx, 1);
        }
      }
      checkInvariants(book);
    }
    expect(book.liveOrderCount).toBe(live.length);
  });
});

describe('L3Book queue cursor', () => {
  it('reports size ahead in O(1) and decays only from orders ahead of it', () => {
    const book = new L3Book({ minPriceTicks: 0, maxPriceTicks: 100, initialOrderCapacity: 8 });
    book.apply(1, EV_NEW_LIMIT_ORDER, 1, SIDE_BID, 50, 100);
    book.apply(2, EV_NEW_LIMIT_ORDER, 2, SIDE_BID, 50, 200);
    const cursor = book.registerCursor(SIDE_BID, 50);
    expect(book.cursorAhead(cursor)).toBe(300);

    book.apply(3, EV_NEW_LIMIT_ORDER, 3, SIDE_BID, 50, 500);
    expect(book.cursorAhead(cursor)).toBe(300);

    book.apply(4, EV_TOTAL_DELETE, 3, SIDE_BID, 50, 500);
    expect(book.cursorAhead(cursor)).toBe(300);

    book.apply(5, EV_PARTIAL_CANCEL, 2, SIDE_BID, 50, 50);
    expect(book.cursorAhead(cursor)).toBe(250);

    book.apply(6, EV_EXECUTE_VISIBLE, 1, SIDE_BID, 50, 100);
    expect(book.cursorAhead(cursor)).toBe(150);

    book.apply(7, EV_TOTAL_DELETE, 2, SIDE_BID, 50, 150);
    expect(book.cursorAhead(cursor)).toBe(0);
    book.releaseCursor(cursor);
  });

  it('does not go negative', () => {
    const book = new L3Book({ minPriceTicks: 0, maxPriceTicks: 100, initialOrderCapacity: 8 });
    book.apply(1, EV_NEW_LIMIT_ORDER, 1, SIDE_BID, 50, 10);
    const cursor = book.registerCursor(SIDE_BID, 50);
    book.apply(2, EV_EXECUTE_VISIBLE, 1, SIDE_BID, 50, 10);
    expect(book.cursorAhead(cursor)).toBe(0);
  });
});

describe('fillFromExecution', () => {
  it('fills only the overflow beyond the queue ahead', () => {
    expect(fillFromExecution(100, 50, 10)).toBe(0);
    expect(fillFromExecution(100, 100, 10)).toBe(0);
    expect(fillFromExecution(100, 105, 10)).toBe(5);
    expect(fillFromExecution(0, 105, 10)).toBe(10);
    expect(fillFromExecution(0, 3, 10)).toBe(3);
  });
});
