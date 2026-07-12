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
import { L3Book } from '@hft/book';

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

interface Order {
  id: number;
  side: Side;
  ticks: number;
  size: number;
}

class ReferenceBook {
  private readonly orders = new Map<number, Order>();
  private readonly levelsBySide: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];

  private bump(side: Side, ticks: number, delta: number): void {
    const levels = this.levelsBySide[side];
    const next = (levels.get(ticks) ?? 0) + delta;
    if (next <= 0) levels.delete(ticks);
    else levels.set(ticks, next);
  }

  add(o: Order): void {
    this.orders.set(o.id, o);
    this.bump(o.side, o.ticks, o.size);
  }
  reduce(id: number, delta: number): void {
    const o = this.orders.get(id);
    if (o === undefined) return;
    const applied = Math.min(delta, o.size);
    o.size -= applied;
    this.bump(o.side, o.ticks, -applied);
    if (o.size <= 0) this.orders.delete(id);
  }
  remove(id: number): void {
    const o = this.orders.get(id);
    if (o === undefined) return;
    this.bump(o.side, o.ticks, -o.size);
    this.orders.delete(id);
  }

  best(side: Side): number {
    let best = NO_PRICE;
    for (const ticks of this.levelsBySide[side].keys()) {
      if (best === NO_PRICE) best = ticks;
      else if (side === SIDE_BID) best = Math.max(best, ticks);
      else best = Math.min(best, ticks);
    }
    return best;
  }

  sizeAt(side: Side, ticks: number): number {
    return this.levelsBySide[side].get(ticks) ?? 0;
  }
}

describe('L3Book output cross-checked against an independent reference book', () => {
  it('best bid/ask, their sizes and sampled level sizes match after every event', () => {
    const rnd = xorshift32(4242);
    const book = new L3Book({ minPriceTicks: 900, maxPriceTicks: 1100, initialOrderCapacity: 8 });
    const ref = new ReferenceBook();
    const live: Order[] = [];
    let nextId = 1;
    let ts = 0;

    for (let step = 0; step < 25000; step++) {
      ts += 1000;
      if (live.length === 0 || rnd() < 0.5) {
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
        const order = { id, side, ticks, size };
        ref.add({ ...order });
        live.push(order);
      } else {
        const idx = Math.floor(rnd() * live.length);
        const o = live[idx];
        const pick = rnd();
        if (pick < 0.35 && o.size > 1) {
          const delta = 1 + Math.floor(rnd() * (o.size - 1));
          book.apply(ts, EV_PARTIAL_CANCEL, o.id, o.side, o.ticks, delta);
          ref.reduce(o.id, delta);
          o.size -= delta;
        } else if (pick < 0.7) {
          book.apply(ts, EV_TOTAL_DELETE, o.id, o.side, o.ticks, o.size);
          ref.remove(o.id);
          live.splice(idx, 1);
        } else {
          const isBest = o.side === SIDE_BID ? o.ticks === book.bestBidTicks() : o.ticks === book.bestAskTicks();
          if (!isBest) continue;
          const exec = 1 + Math.floor(rnd() * o.size);
          book.apply(ts, EV_EXECUTE_VISIBLE, o.id, o.side, o.ticks, exec);
          ref.reduce(o.id, exec);
          o.size -= exec;
          if (o.size === 0) live.splice(idx, 1);
        }
      }

      const bid = book.bestBidTicks();
      const ask = book.bestAskTicks();
      expect(bid).toBe(ref.best(SIDE_BID));
      expect(ask).toBe(ref.best(SIDE_ASK));
      if (bid !== NO_PRICE) expect(book.sizeAt(SIDE_BID, bid)).toBe(ref.sizeAt(SIDE_BID, bid));
      if (ask !== NO_PRICE) expect(book.sizeAt(SIDE_ASK, ask)).toBe(ref.sizeAt(SIDE_ASK, ask));
      for (let t = 995; t <= 1005; t++) {
        expect(book.sizeAt(SIDE_BID, t)).toBe(ref.sizeAt(SIDE_BID, t));
        expect(book.sizeAt(SIDE_ASK, t)).toBe(ref.sizeAt(SIDE_ASK, t));
      }
    }
  });
});
