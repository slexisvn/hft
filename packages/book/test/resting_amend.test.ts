import { describe, expect, it } from 'vitest';
import { EV_NEW_LIMIT_ORDER, SIDE_BID } from '@hft/contracts';
import { L3Book, RestingOrders } from '@hft/book';

function bookWithQueueAhead(aheadSize: number): { book: L3Book; resting: RestingOrders } {
  const book = new L3Book({ minPriceTicks: 900, maxPriceTicks: 1100, initialOrderCapacity: 64 });
  book.apply(0, EV_NEW_LIMIT_ORDER, 1, SIDE_BID, 1000, aheadSize);
  const resting = new RestingOrders();
  return { book, resting };
}

describe('RestingOrders.amendSize', () => {
  it('reduces size in place and keeps the cursor (queue priority) on a size-down', () => {
    const { book, resting } = bookWithQueueAhead(50);
    const order = resting.rest(book, 'us', SIDE_BID, 1000, 20);
    const aheadBefore = book.cursorAhead(order.cursor);
    expect(aheadBefore).toBe(50);

    expect(resting.amendSize(book, 'us', 8)).toBe('amended');
    expect(order.size).toBe(8);
    expect(order.remaining).toBe(8);
    expect(book.cursorAhead(order.cursor)).toBe(50);
  });

  it('rejects a size-up (that would lose priority) and leaves the order untouched', () => {
    const { book, resting } = bookWithQueueAhead(50);
    const order = resting.rest(book, 'us', SIDE_BID, 1000, 20);
    expect(resting.amendSize(book, 'us', 30)).toBe('rejected');
    expect(order.remaining).toBe(20);
  });

  it('removes the order when the new size is at or below the amount already filled', () => {
    const { book, resting } = bookWithQueueAhead(50);
    const order = resting.rest(book, 'us', SIDE_BID, 1000, 20);
    order.remaining = 12;
    expect(resting.amendSize(book, 'us', 5)).toBe('removed');
    expect(resting.has('us')).toBe(false);
  });

  it('reports an unknown order', () => {
    const { book, resting } = bookWithQueueAhead(50);
    expect(resting.amendSize(book, 'ghost', 5)).toBe('unknown');
  });
});
