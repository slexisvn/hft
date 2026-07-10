import { InvariantError, NO_PRICE, SIDE_BID, type Side, type Ticks } from '@hft/contracts';
import type { L3Book } from './book';

export function checkInvariants(book: L3Book): void {
  const bid = book.bestBidTicks();
  const ask = book.bestAskTicks();
  if (bid !== NO_PRICE && ask !== NO_PRICE && bid >= ask) {
    throw new InvariantError(`crossed book: bestBid ${bid} >= bestAsk ${ask}`);
  }

  let seenOrders = 0;
  let observedBestBid = NO_PRICE;
  let observedBestAsk = NO_PRICE;

  book.debugForEachLevel((side: Side, ticks: Ticks, size: number, orders: number) => {
    if (size <= 0 || orders <= 0) {
      throw new InvariantError(`level ${side}:${ticks} has size ${size} and ${orders} orders`);
    }
    const summed = book.debugSumQueue(side, ticks);
    if (summed !== size) {
      throw new InvariantError(`level ${side}:${ticks} size ${size} != queue sum ${summed}`);
    }
    const level = book.debugLevel(side, ticks);
    for (const s of level.sizes) {
      if (s <= 0) throw new InvariantError(`level ${side}:${ticks} contains order with size ${s}`);
    }
    for (const id of level.orders) {
      if (!book.debugHasOrder(id)) {
        throw new InvariantError(`order ${id} in list but not in index`);
      }
    }
    seenOrders += orders;
    if (side === SIDE_BID) {
      if (observedBestBid === NO_PRICE || ticks > observedBestBid) observedBestBid = ticks;
    } else if (observedBestAsk === NO_PRICE || ticks < observedBestAsk) {
      observedBestAsk = ticks;
    }
  });

  if (seenOrders !== book.liveOrderCount) {
    throw new InvariantError(`list order count ${seenOrders} != index size ${book.liveOrderCount}`);
  }
  if (observedBestBid !== bid) {
    throw new InvariantError(`bestBid cache ${bid} != observed ${observedBestBid}`);
  }
  if (observedBestAsk !== ask) {
    throw new InvariantError(`bestAsk cache ${ask} != observed ${observedBestAsk}`);
  }
}
