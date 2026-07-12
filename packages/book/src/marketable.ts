import { NO_PRICE, SIDE_BID, oppositeSide, type BookView, type LevelView, type Side, type Ticks } from '@hft/contracts';

export interface TakerSlice {
  readonly priceTicks: Ticks;
  readonly qty: number;
}

export function isMarketable(view: BookView, side: Side, priceTicks: Ticks): boolean {
  if (side === SIDE_BID) {
    const ask = view.bestAskTicks();
    return ask !== NO_PRICE && priceTicks >= ask;
  }
  const bid = view.bestBidTicks();
  return bid !== NO_PRICE && priceTicks <= bid;
}

export function takerWalk(
  view: BookView,
  side: Side,
  limitTicks: Ticks,
  size: number,
  scratch: LevelView[],
  out: TakerSlice[],
  reservedAt?: (priceTicks: Ticks) => number,
): number {
  const n = view.depth(oppositeSide(side), scratch.length, scratch);
  let remaining = size;
  let slices = 0;
  for (let i = 0; i < n && remaining > 0; i++) {
    const px = scratch[i].priceTicks;
    if (side === SIDE_BID ? px > limitTicks : px < limitTicks) break;
    const available = scratch[i].size - (reservedAt === undefined ? 0 : reservedAt(px));
    if (available <= 0) continue;
    const qty = Math.min(remaining, available);
    out[slices] = { priceTicks: px, qty };
    slices++;
    remaining -= qty;
  }
  return slices;
}
