import { NO_PRICE, type CursorId, type EventType, type Side, type Ticks } from './enums';
import type { Nanos } from './time';

export function midTicksOf(bestBidTicks: Ticks, bestAskTicks: Ticks): number {
  if (bestBidTicks === NO_PRICE || bestAskTicks === NO_PRICE) return NaN;
  return (bestBidTicks + bestAskTicks) / 2;
}

export function spreadTicksOf(bestBidTicks: Ticks, bestAskTicks: Ticks): number {
  if (bestBidTicks === NO_PRICE || bestAskTicks === NO_PRICE) return NaN;
  return bestAskTicks - bestBidTicks;
}

export function microPriceTicksOf(
  bestBidTicks: Ticks,
  bestAskTicks: Ticks,
  bestBidSize: number,
  bestAskSize: number,
): number {
  if (bestBidTicks === NO_PRICE || bestAskTicks === NO_PRICE) return NaN;
  const total = bestBidSize + bestAskSize;
  if (total === 0) return (bestBidTicks + bestAskTicks) / 2;
  return (bestBidTicks * bestAskSize + bestAskTicks * bestBidSize) / total;
}

export interface LevelView {
  priceTicks: Ticks;
  size: number;
  orderCount: number;
}

export interface BookView {
  readonly timestampNs: Nanos;
  bestBidTicks(): Ticks;
  bestAskTicks(): Ticks;
  midTicks(): number;
  spreadTicks(): number;
  microPriceTicks(): number;
  sizeAt(side: Side, priceTicks: Ticks): number;
  orderCountAt(side: Side, priceTicks: Ticks): number;
  depth(side: Side, levels: number, out: LevelView[]): number;
  cursorAhead(cursor: CursorId): number;
  isEmpty(side: Side): boolean;
}

export interface OrderBook extends BookView {
  apply(
    timestampNs: Nanos,
    eventType: EventType,
    orderId: number,
    side: Side,
    priceTicks: Ticks,
    sizeQty: number,
  ): void;
  registerCursor(side: Side, priceTicks: Ticks): CursorId;
  releaseCursor(cursor: CursorId): void;
  reset(): void;
}
