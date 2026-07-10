import type { CursorId, EventType, Side, Ticks } from './enums';
import type { Nanos } from './time';

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
