import {
  InvariantError,
  NO_PRICE,
  SIDE_ASK,
  SIDE_BID,
  microPriceTicksOf,
  midTicksOf,
  spreadTicksOf,
  type BookView,
  type CursorId,
  type LevelView,
  type Nanos,
  type Side,
  type Ticks,
} from '@hft/contracts';
import { LevelBitset } from './level_bitset';
import { scanDepth } from './depth_scan';

export interface L2BookOptions {
  readonly minPriceTicks: number;
  readonly maxPriceTicks: number;
}

const NIL = -1;

export class L2Book implements BookView {
  readonly minPriceTicks: number;
  readonly maxPriceTicks: number;
  private readonly levelCount: number;
  private readonly size: Int32Array;
  private readonly occupied: LevelBitset;

  private cursorCap = 16;
  private cLevel = new Int32Array(this.cursorCap).fill(NIL);
  private cAhead = new Float64Array(this.cursorCap);
  private cNext = new Int32Array(this.cursorCap);
  private cPrev = new Int32Array(this.cursorCap);
  private lvlCursorHead: Int32Array;
  private cursorFree = NIL;
  private cursorTop = 0;

  private bestBid = NO_PRICE;
  private bestAsk = NO_PRICE;
  private ts = 0;

  constructor(opts: L2BookOptions) {
    if (opts.maxPriceTicks <= opts.minPriceTicks) {
      throw new InvariantError('maxPriceTicks must exceed minPriceTicks');
    }
    this.minPriceTicks = opts.minPriceTicks;
    this.maxPriceTicks = opts.maxPriceTicks;
    this.levelCount = opts.maxPriceTicks - opts.minPriceTicks + 1;
    this.size = new Int32Array(this.levelCount * 2);
    this.occupied = new LevelBitset(this.levelCount * 2);
    this.lvlCursorHead = new Int32Array(this.levelCount * 2).fill(NIL);
  }

  get timestampNs(): Nanos {
    return this.ts;
  }

  private levelIndex(side: Side, priceTicks: Ticks): number {
    if (priceTicks < this.minPriceTicks || priceTicks > this.maxPriceTicks) {
      throw new InvariantError(
        `price ${priceTicks} ticks outside configured window [${this.minPriceTicks}, ${this.maxPriceTicks}]`,
      );
    }
    return side * this.levelCount + (priceTicks - this.minPriceTicks);
  }

  setLevel(timestampNs: Nanos, side: Side, priceTicks: Ticks, newSize: number): void {
    if (newSize < 0) throw new InvariantError(`level size must be non-negative, got ${newSize}`);
    this.ts = timestampNs;
    const li = this.levelIndex(side, priceTicks);
    const previous = this.size[li];
    this.size[li] = newSize;

    if (newSize > 0 && previous === 0) this.occupied.set(li);
    else if (newSize === 0 && previous > 0) this.occupied.clear(li);

    if (newSize < previous) this.clampCursors(li, newSize);

    if (newSize > 0) {
      if (side === SIDE_BID) {
        if (this.bestBid === NO_PRICE || priceTicks > this.bestBid) this.bestBid = priceTicks;
      } else if (this.bestAsk === NO_PRICE || priceTicks < this.bestAsk) {
        this.bestAsk = priceTicks;
      }
      return;
    }
    if (previous > 0) this.repairBest(side, priceTicks);
  }

  applyTrade(timestampNs: Nanos, restingSide: Side, priceTicks: Ticks, tradedSize: number): void {
    this.ts = timestampNs;
    if (priceTicks < this.minPriceTicks || priceTicks > this.maxPriceTicks) return;
    const li = restingSide * this.levelCount + (priceTicks - this.minPriceTicks);
    let c = this.lvlCursorHead[li];
    while (c !== NIL) {
      const next = this.cAhead[c] - tradedSize;
      this.cAhead[c] = next > 0 ? next : 0;
      c = this.cNext[c];
    }
  }

  private clampCursors(li: number, newSize: number): void {
    let c = this.lvlCursorHead[li];
    while (c !== NIL) {
      if (this.cAhead[c] > newSize) this.cAhead[c] = newSize;
      c = this.cNext[c];
    }
  }

  private repairBest(side: Side, priceTicks: Ticks): void {
    if (side === SIDE_BID) {
      if (priceTicks !== this.bestBid) return;
      const li = this.occupied.prevSetAtOrBelow(priceTicks - this.minPriceTicks - 1);
      this.bestBid = li < 0 ? NO_PRICE : li + this.minPriceTicks;
      return;
    }
    if (priceTicks !== this.bestAsk) return;
    const base = this.levelCount;
    const li = this.occupied.nextSetAtOrAbove(base + (priceTicks - this.minPriceTicks) + 1);
    this.bestAsk = li < 0 ? NO_PRICE : li - base + this.minPriceTicks;
  }

  reset(): void {
    this.size.fill(0);
    this.occupied.clearAll();
    this.lvlCursorHead.fill(NIL);
    this.cursorFree = NIL;
    this.cursorTop = 0;
    this.bestBid = NO_PRICE;
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
    return this.size[side * this.levelCount + (priceTicks - this.minPriceTicks)];
  }

  orderCountAt(): number {
    return 0;
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
      this.size,
    );
  }

  registerCursor(side: Side, priceTicks: Ticks): CursorId {
    const li = this.levelIndex(side, priceTicks);
    const c = this.allocCursor();
    this.cLevel[c] = li;
    this.cAhead[c] = this.size[li];
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
    if (li === NIL) return;
    const prev = this.cPrev[cursor];
    const next = this.cNext[cursor];
    if (prev === NIL) this.lvlCursorHead[li] = next;
    else this.cNext[prev] = next;
    if (next !== NIL) this.cPrev[next] = prev;
    this.cLevel[cursor] = NIL;
    this.cNext[cursor] = this.cursorFree;
    this.cursorFree = cursor;
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
      this.cNext = growI32(this.cNext, n);
      this.cPrev = growI32(this.cPrev, n);
      this.cursorCap = n;
    }
    return this.cursorTop++;
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
