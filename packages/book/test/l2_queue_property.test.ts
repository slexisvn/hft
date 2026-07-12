import { describe, expect, it } from 'vitest';
import {
  EV_EXECUTE_VISIBLE,
  EV_NEW_LIMIT_ORDER,
  EV_PARTIAL_CANCEL,
  EV_TOTAL_DELETE,
  SIDE_ASK,
  SIDE_BID,
  type EventType,
  type Side,
} from '@hft/contracts';
import { L2Book, L3Book } from '@hft/book';

const MIN = 900;
const MAX = 1100;
const TARGET_SIDE: Side = SIDE_BID;
const TARGET_PRICE = 1000;

interface Order {
  id: number;
  size: number;
}
interface Event {
  type: EventType;
  side: Side;
  price: number;
  id: number;
  size: number;
}

function xorshift32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function generate(n: number, seed: number): Event[] {
  const rnd = xorshift32(seed);
  const prices = [998, 999, 1000, 1001, 1002];
  const queues = new Map<number, Order[]>();
  const key = (side: Side, price: number): number => side * 4096 + price;
  const events: Event[] = [];
  let nextId = 1;

  for (let i = 0; i < n; i++) {
    const nonEmpty: number[] = [];
    for (const [k, q] of queues) if (q.length > 0) nonEmpty.push(k);

    if (nonEmpty.length === 0 || rnd() < 0.6) {
      const side: Side = rnd() < 0.5 ? SIDE_BID : SIDE_ASK;
      const price = prices[Math.floor(rnd() * prices.length)];
      const size = 1 + Math.floor(rnd() * 40);
      const k = key(side, price);
      const q = queues.get(k) ?? [];
      q.push({ id: nextId, size });
      queues.set(k, q);
      events.push({ type: EV_NEW_LIMIT_ORDER, side, price, id: nextId, size });
      nextId++;
      continue;
    }

    const k = nonEmpty[Math.floor(rnd() * nonEmpty.length)];
    const q = queues.get(k) as Order[];
    const side = (k >= 4096 ? SIDE_ASK : SIDE_BID) as Side;
    const price = k - side * 4096;
    const roll = rnd();
    if (roll < 0.5) {
      const front = q.shift() as Order;
      events.push({ type: EV_EXECUTE_VISIBLE, side, price, id: front.id, size: front.size });
    } else if (roll < 0.75 && q.length > 0) {
      const j = Math.floor(rnd() * q.length);
      const o = q[j];
      if (o.size > 1) {
        const delta = 1 + Math.floor(rnd() * (o.size - 1));
        o.size -= delta;
        events.push({ type: EV_PARTIAL_CANCEL, side, price, id: o.id, size: delta });
      } else {
        q.splice(j, 1);
        events.push({ type: EV_TOTAL_DELETE, side, price, id: o.id, size: o.size });
      }
    } else if (q.length > 0) {
      const j = Math.floor(rnd() * q.length);
      const o = q.splice(j, 1)[0];
      events.push({ type: EV_TOTAL_DELETE, side, price, id: o.id, size: o.size });
    }
  }
  return events;
}

function apply(l3: L3Book, l2: L2Book, e: Event, ts: number): void {
  if (e.type === EV_EXECUTE_VISIBLE) {
    l2.applyTrade(ts, e.side, e.price, e.size);
    l3.apply(ts, e.type, e.id, e.side, e.price, e.size);
    l2.setLevel(ts, e.side, e.price, l3.sizeAt(e.side, e.price));
    return;
  }
  l3.apply(ts, e.type, e.id, e.side, e.price, e.size);
  l2.setLevel(ts, e.side, e.price, l3.sizeAt(e.side, e.price));
}

describe('L2 queue model is conservative versus the L3 ground truth', () => {
  it('L2 cursorAhead never underestimates the L3 truth, and the error stays bounded', () => {
    for (const seed of [1, 7, 42, 20260710]) {
      const events = generate(6000, seed);
      const l3 = new L3Book({ minPriceTicks: MIN, maxPriceTicks: MAX, initialOrderCapacity: 4096 });
      const l2 = new L2Book({ minPriceTicks: MIN, maxPriceTicks: MAX });

      let c3 = -1;
      let c2 = -1;
      let maxError = 0;
      let comparisons = 0;

      for (let i = 0; i < events.length; i++) {
        apply(l3, l2, events[i], i * 1000);
        if (c3 < 0 && i > 200 && l3.sizeAt(TARGET_SIDE, TARGET_PRICE) > 0) {
          c3 = l3.registerCursor(TARGET_SIDE, TARGET_PRICE);
          c2 = l2.registerCursor(TARGET_SIDE, TARGET_PRICE);
        }
        if (c3 >= 0) {
          const l3Ahead = l3.cursorAhead(c3);
          const l2Ahead = l2.cursorAhead(c2);
          expect(l2Ahead).toBeGreaterThanOrEqual(l3Ahead);
          const err = l2Ahead - l3Ahead;
          if (err > maxError) maxError = err;
          comparisons++;
        }
      }

      expect(comparisons).toBeGreaterThan(0);
      expect(maxError).toBeLessThan(2000);
    }
  });
});
