import {
  EV_EXECUTE_VISIBLE,
  EV_NEW_LIMIT_ORDER,
  EV_PARTIAL_CANCEL,
  EV_TOTAL_DELETE,
  InvariantError,
  NO_PRICE,
  SIDE_ASK,
  SIDE_BID,
  microPriceTicksOf,
  midTicksOf,
  spreadTicksOf,
  type CursorId,
  type EventType,
  type LevelView,
  type Nanos,
  type OrderBook,
  type Side,
  type Ticks,
} from '@hft/contracts';
import { scanDepth } from './depth_scan';

export interface BookOptions {
  readonly minPriceTicks: number;
  readonly maxPriceTicks: number;
  readonly initialOrderCapacity: number;
}

const NIL = -1;

export class L3Book implements OrderBook {
  readonly minPriceTicks: number;
  readonly maxPriceTicks: number;
  private readonly levelCount: number;

  private readonly lvlHead: Int32Array;
  private readonly lvlTail: Int32Array;
  private readonly lvlSize: Int32Array;
  private readonly lvlOrders: Int32Array;
  private readonly lvlCumAdded: Float64Array;
  private readonly lvlCursorHead: Int32Array;

  private nodeCap: number;
  private nNext: Int32Array;
  private nPrev: Int32Array;
  private nSize: Int32Array;
  private nCumBefore: Float64Array;
  private nLevel: Int32Array;
  private nOrderId: Int32Array;
  private nodeFree = NIL;
  private nodeTop = 0;

  private cursorCap: number;
  private cLevel: Int32Array;
  private cAhead: Float64Array;
  private cCumBefore: Float64Array;
  private cNext: Int32Array;
  private cPrev: Int32Array;
  private cursorFree = NIL;
  private cursorTop = 0;

  private readonly byOrderId = new Map<number, number>();

  private bestBid = NO_PRICE;
  private bestAsk = NO_PRICE;
  private ts = 0;
  private unknownOrderEvents = 0;

  constructor(opts: BookOptions) {
    if (opts.maxPriceTicks <= opts.minPriceTicks) {
      throw new InvariantError('maxPriceTicks must exceed minPriceTicks');
    }
    this.minPriceTicks = opts.minPriceTicks;
    this.maxPriceTicks = opts.maxPriceTicks;
    this.levelCount = opts.maxPriceTicks - opts.minPriceTicks + 1;

    const n2 = this.levelCount * 2;
    this.lvlHead = new Int32Array(n2).fill(NIL);
    this.lvlTail = new Int32Array(n2).fill(NIL);
    this.lvlSize = new Int32Array(n2);
    this.lvlOrders = new Int32Array(n2);
    this.lvlCumAdded = new Float64Array(n2);
    this.lvlCursorHead = new Int32Array(n2).fill(NIL);

    this.nodeCap = Math.max(16, opts.initialOrderCapacity);
    this.nNext = new Int32Array(this.nodeCap);
    this.nPrev = new Int32Array(this.nodeCap);
    this.nSize = new Int32Array(this.nodeCap);
    this.nCumBefore = new Float64Array(this.nodeCap);
    this.nLevel = new Int32Array(this.nodeCap);
    this.nOrderId = new Int32Array(this.nodeCap);

    this.cursorCap = 16;
    this.cLevel = new Int32Array(this.cursorCap);
    this.cAhead = new Float64Array(this.cursorCap);
    this.cCumBefore = new Float64Array(this.cursorCap);
    this.cNext = new Int32Array(this.cursorCap);
    this.cPrev = new Int32Array(this.cursorCap);
  }

  get timestampNs(): Nanos {
    return this.ts;
  }

  get unknownOrderEventCount(): number {
    return this.unknownOrderEvents;
  }

  get liveOrderCount(): number {
    return this.byOrderId.size;
  }

  private levelIndex(side: Side, priceTicks: Ticks): number {
    if (priceTicks < this.minPriceTicks || priceTicks > this.maxPriceTicks) {
      throw new InvariantError(
        `price ${priceTicks} ticks outside configured window [${this.minPriceTicks}, ${this.maxPriceTicks}]`,
      );
    }
    return side * this.levelCount + (priceTicks - this.minPriceTicks);
  }

  apply(
    timestampNs: Nanos,
    eventType: EventType,
    orderId: number,
    side: Side,
    priceTicks: Ticks,
    sizeQty: number,
  ): void {
    this.ts = timestampNs;
    switch (eventType) {
      case EV_NEW_LIMIT_ORDER:
        if (sizeQty > 0) this.addOrder(orderId, side, priceTicks, sizeQty);
        return;
      case EV_PARTIAL_CANCEL:
      case EV_EXECUTE_VISIBLE:
        this.reduceOrder(orderId, sizeQty);
        return;
      case EV_TOTAL_DELETE:
        this.removeOrder(orderId);
        return;
      default:
        return;
    }
  }

  private addOrder(orderId: number, side: Side, priceTicks: Ticks, size: number): void {
    if (this.byOrderId.has(orderId)) {
      this.unknownOrderEvents++;
      return;
    }
    const li = this.levelIndex(side, priceTicks);
    const node = this.allocNode();
    this.nOrderId[node] = orderId;
    this.nSize[node] = size;
    this.nLevel[node] = li;
    this.nCumBefore[node] = this.lvlCumAdded[li];
    this.nNext[node] = NIL;
    this.nPrev[node] = this.lvlTail[li];

    if (this.lvlTail[li] === NIL) this.lvlHead[li] = node;
    else this.nNext[this.lvlTail[li]] = node;
    this.lvlTail[li] = node;

    this.lvlSize[li] += size;
    this.lvlOrders[li] += 1;
    this.lvlCumAdded[li] += size;
    this.byOrderId.set(orderId, node);

    if (side === SIDE_BID) {
      if (this.bestBid === NO_PRICE || priceTicks > this.bestBid) this.bestBid = priceTicks;
    } else if (this.bestAsk === NO_PRICE || priceTicks < this.bestAsk) {
      this.bestAsk = priceTicks;
    }
  }

  private reduceOrder(orderId: number, delta: number): void {
    const node = this.byOrderId.get(orderId);
    if (node === undefined) {
      this.unknownOrderEvents++;
      return;
    }
    const current = this.nSize[node];
    if (delta >= current) {
      this.unlink(node, current);
      return;
    }
    this.nSize[node] = current - delta;
    const li = this.nLevel[node];
    this.lvlSize[li] -= delta;
    this.notifyCursors(li, this.nCumBefore[node], delta);
  }

  private removeOrder(orderId: number): void {
    const node = this.byOrderId.get(orderId);
    if (node === undefined) {
      this.unknownOrderEvents++;
      return;
    }
    this.unlink(node, this.nSize[node]);
  }

  private unlink(node: number, removedSize: number): void {
    const li = this.nLevel[node];
    const prev = this.nPrev[node];
    const next = this.nNext[node];
    if (prev === NIL) this.lvlHead[li] = next;
    else this.nNext[prev] = next;
    if (next === NIL) this.lvlTail[li] = prev;
    else this.nPrev[next] = prev;

    this.lvlSize[li] -= removedSize;
    this.lvlOrders[li] -= 1;
    this.byOrderId.delete(this.nOrderId[node]);
    this.notifyCursors(li, this.nCumBefore[node], removedSize);
    this.freeNode(node);

    if (this.lvlSize[li] === 0) this.repairBest(li);
  }

  private notifyCursors(li: number, nodeCumBefore: number, removedSize: number): void {
    let c = this.lvlCursorHead[li];
    while (c !== NIL) {
      if (this.cCumBefore[c] > nodeCumBefore) {
        const next = this.cAhead[c] - removedSize;
        this.cAhead[c] = next > 0 ? next : 0;
      }
      c = this.cNext[c];
    }
  }

  private repairBest(li: number): void {
    const side: Side = li >= this.levelCount ? SIDE_ASK : SIDE_BID;
    const ticks = (li % this.levelCount) + this.minPriceTicks;
    if (side === SIDE_BID) {
      if (ticks !== this.bestBid) return;
      let t = ticks - 1;
      const base = 0;
      while (t >= this.minPriceTicks) {
        if (this.lvlSize[base + (t - this.minPriceTicks)] > 0) {
          this.bestBid = t;
          return;
        }
        t--;
      }
      this.bestBid = NO_PRICE;
      return;
    }
    if (ticks !== this.bestAsk) return;
    let t = ticks + 1;
    const base = this.levelCount;
    while (t <= this.maxPriceTicks) {
      if (this.lvlSize[base + (t - this.minPriceTicks)] > 0) {
        this.bestAsk = t;
        return;
      }
      t++;
    }
    this.bestAsk = NO_PRICE;
  }

  bestBidTicks(): Ticks {
    return this.bestBid;
  }
  bestAskTicks(): Ticks {
    return this.bestAsk;
  }
  isEmpty(side: Side): boolean {
    return (side === SIDE_BID ? this.bestBid : this.bestAsk) === NO_PRICE;
  }

  midTicks(): number {
    return midTicksOf(this.bestBid, this.bestAsk);
  }

  spreadTicks(): number {
    return spreadTicksOf(this.bestBid, this.bestAsk);
  }

  microPriceTicks(): number {
    if (this.bestBid === NO_PRICE || this.bestAsk === NO_PRICE) return NaN;
    return microPriceTicksOf(
      this.bestBid,
      this.bestAsk,
      this.sizeAt(SIDE_BID, this.bestBid),
      this.sizeAt(SIDE_ASK, this.bestAsk),
    );
  }

  sizeAt(side: Side, priceTicks: Ticks): number {
    if (priceTicks < this.minPriceTicks || priceTicks > this.maxPriceTicks) return 0;
    return this.lvlSize[side * this.levelCount + (priceTicks - this.minPriceTicks)];
  }

  orderCountAt(side: Side, priceTicks: Ticks): number {
    if (priceTicks < this.minPriceTicks || priceTicks > this.maxPriceTicks) return 0;
    return this.lvlOrders[side * this.levelCount + (priceTicks - this.minPriceTicks)];
  }

  depth(side: Side, levels: number, out: LevelView[]): number {
    return scanDepth(
      side,
      levels,
      out,
      this.bestBid,
      this.bestAsk,
      this.minPriceTicks,
      this.maxPriceTicks,
      side * this.levelCount,
      this.lvlSize,
      this.lvlOrders,
    );
  }

  registerCursor(side: Side, priceTicks: Ticks): CursorId {
    const li = this.levelIndex(side, priceTicks);
    const c = this.allocCursor();
    this.cLevel[c] = li;
    this.cCumBefore[c] = this.lvlCumAdded[li];
    this.cAhead[c] = this.lvlSize[li];
    this.cPrev[c] = NIL;
    this.cNext[c] = this.lvlCursorHead[li];
    if (this.lvlCursorHead[li] !== NIL) this.cPrev[this.lvlCursorHead[li]] = c;
    this.lvlCursorHead[li] = c;
    return c;
  }

  cursorAhead(cursor: CursorId): number {
    return this.cAhead[cursor];
  }

  releaseCursor(cursor: CursorId): void {
    const li = this.cLevel[cursor];
    const prev = this.cPrev[cursor];
    const next = this.cNext[cursor];
    if (prev === NIL) this.lvlCursorHead[li] = next;
    else this.cNext[prev] = next;
    if (next !== NIL) this.cPrev[next] = prev;
    this.cLevel[cursor] = NIL;
    this.cNext[cursor] = this.cursorFree;
    this.cursorFree = cursor;
  }

  reset(): void {
    this.lvlHead.fill(NIL);
    this.lvlTail.fill(NIL);
    this.lvlSize.fill(0);
    this.lvlOrders.fill(0);
    this.lvlCumAdded.fill(0);
    this.lvlCursorHead.fill(NIL);
    this.byOrderId.clear();
    this.nodeFree = NIL;
    this.nodeTop = 0;
    this.cursorFree = NIL;
    this.cursorTop = 0;
    this.bestBid = NO_PRICE;
    this.bestAsk = NO_PRICE;
    this.ts = 0;
    this.unknownOrderEvents = 0;
  }

  private allocNode(): number {
    if (this.nodeFree !== NIL) {
      const n = this.nodeFree;
      this.nodeFree = this.nNext[n];
      return n;
    }
    if (this.nodeTop === this.nodeCap) this.growNodes();
    return this.nodeTop++;
  }

  private freeNode(node: number): void {
    this.nNext[node] = this.nodeFree;
    this.nodeFree = node;
  }

  private growNodes(): void {
    const n = this.nodeCap * 2;
    this.nNext = growI32(this.nNext, n);
    this.nPrev = growI32(this.nPrev, n);
    this.nSize = growI32(this.nSize, n);
    this.nCumBefore = growF64(this.nCumBefore, n);
    this.nLevel = growI32(this.nLevel, n);
    this.nOrderId = growI32(this.nOrderId, n);
    this.nodeCap = n;
  }

  private allocCursor(): number {
    if (this.cursorFree !== NIL) {
      const c = this.cursorFree;
      this.cursorFree = this.cNext[c];
      return c;
    }
    if (this.cursorTop === this.cursorCap) {
      const n = this.cursorCap * 2;
      this.cLevel = growI32(this.cLevel, n);
      this.cAhead = growF64(this.cAhead, n);
      this.cCumBefore = growF64(this.cCumBefore, n);
      this.cNext = growI32(this.cNext, n);
      this.cPrev = growI32(this.cPrev, n);
      this.cursorCap = n;
    }
    return this.cursorTop++;
  }

  debugLevel(side: Side, priceTicks: Ticks): { size: number; orders: number[]; sizes: number[] } {
    const li = this.levelIndex(side, priceTicks);
    const orders: number[] = [];
    const sizes: number[] = [];
    let n = this.lvlHead[li];
    while (n !== NIL) {
      orders.push(this.nOrderId[n]);
      sizes.push(this.nSize[n]);
      n = this.nNext[n];
    }
    return { size: this.lvlSize[li], orders, sizes };
  }

  debugForEachLevel(fn: (side: Side, priceTicks: Ticks, size: number, orders: number) => void): void {
    for (let li = 0; li < this.levelCount * 2; li++) {
      if (this.lvlSize[li] === 0 && this.lvlOrders[li] === 0) continue;
      const side: Side = li >= this.levelCount ? SIDE_ASK : SIDE_BID;
      const ticks = (li % this.levelCount) + this.minPriceTicks;
      fn(side, ticks, this.lvlSize[li], this.lvlOrders[li]);
    }
  }

  debugOrderIds(): IterableIterator<number> {
    return this.byOrderId.keys();
  }

  debugHasOrder(orderId: number): boolean {
    return this.byOrderId.has(orderId);
  }

  debugSumQueue(side: Side, priceTicks: Ticks): number {
    const li = this.levelIndex(side, priceTicks);
    let sum = 0;
    let n = this.lvlHead[li];
    while (n !== NIL) {
      sum += this.nSize[n];
      n = this.nNext[n];
    }
    return sum;
  }
}

function growI32(a: Int32Array, n: number): Int32Array {
  const b = new Int32Array(n);
  b.set(a);
  return b;
}
function growF64(a: Float64Array, n: number): Float64Array {
  const b = new Float64Array(n);
  b.set(a);
  return b;
}

export function makeLevelViews(n: number): LevelView[] {
  const out: LevelView[] = [];
  for (let i = 0; i < n; i++) out.push({ priceTicks: NO_PRICE, size: 0, orderCount: 0 });
  return out;
}
