import { describe, expect, it } from 'vitest';
import { EV_NEW_LIMIT_ORDER, SIDE_ASK, SIDE_BID, oppositeSide, type Ticks } from '@hft/contracts';
import { L3Book, LiquidityLedger, makeLevelViews, takerWalk, type TakerSlice } from '@hft/book';

function bookWithAsk(size: number): L3Book {
  const book = new L3Book({ minPriceTicks: 900, maxPriceTicks: 1100, initialOrderCapacity: 64 });
  book.apply(0, EV_NEW_LIMIT_ORDER, 1, SIDE_ASK, 1000, size);
  return book;
}

function walkSizes(book: L3Book, ledger: LiquidityLedger | null): number {
  const scratch = makeLevelViews(5);
  const out: TakerSlice[] = [];
  const eaten = oppositeSide(SIDE_BID);
  const reserved = ledger === null ? undefined : (px: Ticks) => ledger.reservedAt(eaten, px);
  const n = takerWalk(book, SIDE_BID, 1000, 600, scratch, out, reserved);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += out[i].qty;
    if (ledger !== null) ledger.consume(eaten, out[i].priceTicks, out[i].qty);
  }
  return total;
}

describe('LiquidityLedger prevents two takers double-eating one level in an instant', () => {
  it('the second taker only takes what the first left behind', () => {
    const book = bookWithAsk(1002);
    const ledger = new LiquidityLedger();
    ledger.resetAt(0);
    expect(walkSizes(book, ledger)).toBe(600);
    expect(walkSizes(book, ledger)).toBe(402);
  });

  it('without the ledger the same level is eaten twice (the bug this guards against)', () => {
    const book = bookWithAsk(1002);
    expect(walkSizes(book, null)).toBe(600);
    expect(walkSizes(book, null)).toBe(600);
  });

  it('resets consumed liquidity when the instant advances', () => {
    const book = bookWithAsk(1002);
    const ledger = new LiquidityLedger();
    ledger.resetAt(0);
    expect(walkSizes(book, ledger)).toBe(600);
    ledger.resetAt(1);
    expect(walkSizes(book, ledger)).toBe(600);
  });
});
