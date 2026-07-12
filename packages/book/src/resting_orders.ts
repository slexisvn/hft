import { InvariantError, type CursorId, type OrderBook, type OrderState, type Side, type Ticks } from '@hft/contracts';
import { fillFromExecution } from './queue_fill';

export interface RestingOrder {
  readonly clientOrderId: string;
  readonly side: Side;
  readonly priceTicks: Ticks;
  size: number;
  remaining: number;
  cursor: CursorId;
  state: OrderState;
}

export type AmendOutcome = 'amended' | 'removed' | 'rejected' | 'unknown';

function levelKey(side: Side, priceTicks: Ticks): number {
  return side * 0x40000000 + priceTicks;
}

export class RestingOrders {
  private readonly orders = new Map<string, RestingOrder>();
  private readonly byLevel = new Map<number, RestingOrder[]>();

  get size(): number {
    return this.orders.size;
  }

  has(clientOrderId: string): boolean {
    return this.orders.has(clientOrderId);
  }

  get(clientOrderId: string): RestingOrder | undefined {
    return this.orders.get(clientOrderId);
  }

  all(): IterableIterator<RestingOrder> {
    return this.orders.values();
  }

  ordersAt(side: Side, priceTicks: Ticks): readonly RestingOrder[] | undefined {
    return this.byLevel.get(levelKey(side, priceTicks));
  }

  rest(book: OrderBook, clientOrderId: string, side: Side, priceTicks: Ticks, size: number): RestingOrder {
    if (this.orders.has(clientOrderId)) {
      throw new InvariantError(`duplicate resting client order id "${clientOrderId}"`);
    }
    const order: RestingOrder = {
      clientOrderId,
      side,
      priceTicks,
      size,
      remaining: size,
      cursor: book.registerCursor(side, priceTicks),
      state: 'acked',
    };
    this.orders.set(clientOrderId, order);
    const key = levelKey(side, priceTicks);
    const bucket = this.byLevel.get(key);
    if (bucket === undefined) this.byLevel.set(key, [order]);
    else bucket.push(order);
    return order;
  }

  amendSize(book: OrderBook, clientOrderId: string, newSize: number): AmendOutcome {
    const order = this.orders.get(clientOrderId);
    if (order === undefined) return 'unknown';
    const filled = order.size - order.remaining;
    if (newSize >= order.size) return 'rejected';
    if (newSize <= filled) {
      this.remove(book, clientOrderId, 'filled');
      return 'removed';
    }
    order.size = newSize;
    order.remaining = newSize - filled;
    return 'amended';
  }

  remove(book: OrderBook, clientOrderId: string, state: OrderState): RestingOrder | undefined {
    const order = this.orders.get(clientOrderId);
    if (order === undefined) return undefined;
    book.releaseCursor(order.cursor);
    order.state = state;
    this.orders.delete(clientOrderId);
    const key = levelKey(order.side, order.priceTicks);
    const bucket = this.byLevel.get(key);
    if (bucket !== undefined) {
      const i = bucket.indexOf(order);
      if (i >= 0) bucket.splice(i, 1);
      if (bucket.length === 0) this.byLevel.delete(key);
    }
    return order;
  }
}

export type RestingFillSink = (order: RestingOrder, qty: number, queuePosition: number) => void;

export class ExecutionMatcher {
  private readonly candidates: RestingOrder[] = [];
  private readonly aheads: number[] = [];
  private count = 0;

  capture(book: OrderBook, resting: RestingOrders, side: Side, priceTicks: Ticks): void {
    this.count = 0;
    const bucket = resting.ordersAt(side, priceTicks);
    if (bucket === undefined) return;
    for (let i = 0; i < bucket.length; i++) {
      this.candidates[this.count] = bucket[i];
      this.aheads[this.count] = book.cursorAhead(bucket[i].cursor);
      this.count++;
    }
  }

  resolve(book: OrderBook, resting: RestingOrders, executedSize: number, sink: RestingFillSink): void {
    for (let i = 0; i < this.count; i++) {
      const order = this.candidates[i];
      const qty = fillFromExecution(this.aheads[i], executedSize, order.remaining);
      if (qty <= 0) continue;
      const queuePosition = this.aheads[i];
      order.remaining -= qty;
      if (order.remaining === 0) resting.remove(book, order.clientOrderId, 'filled');
      else order.state = 'partial';
      sink(order, qty, queuePosition);
    }
    this.count = 0;
  }
}
