import { describe, expect, it } from 'vitest';
import { InvariantError, NO_PRICE, SIDE_ASK, SIDE_BID } from '@hft/contracts';
import { L2Book, makeLevelViews } from '@hft/book';

function book(): L2Book {
  const b = new L2Book({ minPriceTicks: 0, maxPriceTicks: 200 });
  b.setLevel(1, SIDE_BID, 100, 50);
  b.setLevel(1, SIDE_BID, 99, 20);
  b.setLevel(1, SIDE_ASK, 102, 40);
  b.setLevel(1, SIDE_ASK, 103, 60);
  return b;
}

describe('L2Book', () => {
  it('tracks best bid and ask as levels appear and vanish', () => {
    const b = book();
    expect(b.bestBidTicks()).toBe(100);
    expect(b.bestAskTicks()).toBe(102);
    b.setLevel(2, SIDE_BID, 100, 0);
    expect(b.bestBidTicks()).toBe(99);
    b.setLevel(3, SIDE_BID, 99, 0);
    expect(b.bestBidTicks()).toBe(NO_PRICE);
    expect(b.isEmpty(SIDE_BID)).toBe(true);
    expect(Number.isNaN(b.midTicks())).toBe(true);
  });

  it('replaces a level absolutely rather than accumulating', () => {
    const b = book();
    b.setLevel(2, SIDE_BID, 100, 7);
    expect(b.sizeAt(SIDE_BID, 100)).toBe(7);
  });

  it('walks depth outward from the best price', () => {
    const out = makeLevelViews(3);
    const n = book().depth(SIDE_ASK, 3, out);
    expect(n).toBe(2);
    expect(out[0].priceTicks).toBe(102);
    expect(out[1].priceTicks).toBe(103);
  });

  it('rejects a negative level size and a price outside the window', () => {
    const b = book();
    expect(() => b.setLevel(2, SIDE_BID, 100, -1)).toThrowError(InvariantError);
    expect(() => b.setLevel(2, SIDE_BID, 999, 1)).toThrowError(/outside configured window/);
  });
});

describe('L2Book queue cursors model what L2 can actually know', () => {
  it('starts a cursor behind the whole visible level', () => {
    const b = book();
    const c = b.registerCursor(SIDE_BID, 100);
    expect(b.cursorAhead(c)).toBe(50);
  });

  it('advances the queue only on trades, because trades consume the front', () => {
    const b = book();
    const c = b.registerCursor(SIDE_BID, 100);
    b.applyTrade(2, SIDE_BID, 100, 30);
    expect(b.cursorAhead(c)).toBe(20);
    b.applyTrade(3, SIDE_BID, 100, 100);
    expect(b.cursorAhead(c)).toBe(0);
  });

  it('does not advance the queue on a pure size decrease, since a cancel may sit behind us', () => {
    const b = book();
    const c = b.registerCursor(SIDE_BID, 100);
    b.setLevel(2, SIDE_BID, 100, 45);
    expect(b.cursorAhead(c)).toBe(45);
    b.setLevel(3, SIDE_BID, 100, 60);
    expect(b.cursorAhead(c)).toBe(45);
  });

  it('never claims more size ahead than the level actually holds', () => {
    const b = book();
    const c = b.registerCursor(SIDE_BID, 100);
    b.setLevel(2, SIDE_BID, 100, 5);
    expect(b.cursorAhead(c)).toBe(5);
  });

  it('ignores trades at a price outside the window', () => {
    const b = book();
    const c = b.registerCursor(SIDE_BID, 100);
    b.applyTrade(2, SIDE_BID, 999, 10);
    expect(b.cursorAhead(c)).toBe(50);
  });

  it('recycles released cursors', () => {
    const b = book();
    const c = b.registerCursor(SIDE_BID, 100);
    b.releaseCursor(c);
    b.applyTrade(2, SIDE_BID, 100, 10);
    const d = b.registerCursor(SIDE_BID, 100);
    expect(d).toBe(c);
    expect(b.cursorAhead(d)).toBe(50);
  });
});
