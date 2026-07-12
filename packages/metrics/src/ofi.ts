import { NO_PRICE } from '@hft/contracts';

export function ofiContribution(
  prevBidTicks: number,
  prevBidSize: number,
  prevAskTicks: number,
  prevAskSize: number,
  bidTicks: number,
  bidSize: number,
  askTicks: number,
  askSize: number,
): number {
  let e = 0;
  if (bidTicks >= prevBidTicks) e += bidSize;
  if (bidTicks <= prevBidTicks) e -= prevBidSize;
  if (askTicks <= prevAskTicks) e -= askSize;
  if (askTicks >= prevAskTicks) e += prevAskSize;
  return e;
}

class OfiState {
  protected prevBid = NO_PRICE;
  protected prevBidSize = 0;
  protected prevAsk = NO_PRICE;
  protected prevAskSize = 0;
  protected started = false;

  protected step(bidTicks: number, bidSize: number, askTicks: number, askSize: number): number {
    if (!this.started) {
      this.started = true;
      this.prevBid = bidTicks;
      this.prevBidSize = bidSize;
      this.prevAsk = askTicks;
      this.prevAskSize = askSize;
      return 0;
    }
    const e = ofiContribution(
      this.prevBid,
      this.prevBidSize,
      this.prevAsk,
      this.prevAskSize,
      bidTicks,
      bidSize,
      askTicks,
      askSize,
    );
    this.prevBid = bidTicks;
    this.prevBidSize = bidSize;
    this.prevAsk = askTicks;
    this.prevAskSize = askSize;
    return e;
  }
}

export class OfiAccumulator extends OfiState {
  private total = 0;

  get value(): number {
    return this.total;
  }

  reset(): void {
    this.total = 0;
  }

  update(bidTicks: number, bidSize: number, askTicks: number, askSize: number): number {
    const e = this.step(bidTicks, bidSize, askTicks, askSize);
    this.total += e;
    return e;
  }
}

export class WindowedOfi extends OfiState {
  private readonly windowNs: number;
  private ts: Float64Array;
  private contrib: Float64Array;
  private head = 0;
  private count = 0;
  private sum = 0;

  constructor(windowNs: number, initialCapacity = 64) {
    super();
    if (!(windowNs > 0)) throw new Error(`WindowedOfi requires a positive windowNs, got ${windowNs}`);
    this.windowNs = windowNs;
    this.ts = new Float64Array(initialCapacity);
    this.contrib = new Float64Array(initialCapacity);
  }

  get value(): number {
    return this.sum;
  }

  update(atNs: number, bidTicks: number, bidSize: number, askTicks: number, askSize: number): number {
    const e = this.step(bidTicks, bidSize, askTicks, askSize);
    if (e !== 0) this.push(atNs, e);
    this.evictBefore(atNs);
    return this.sum;
  }

  valueAsOf(atNs: number): number {
    this.evictBefore(atNs);
    return this.sum;
  }

  private evictBefore(nowNs: number): void {
    const cutoff = nowNs - this.windowNs;
    const cap = this.ts.length;
    while (this.count > 0 && this.ts[this.head] <= cutoff) {
      this.sum -= this.contrib[this.head];
      this.head = this.head + 1 === cap ? 0 : this.head + 1;
      this.count--;
    }
  }

  private push(atNs: number, e: number): void {
    if (this.count === this.ts.length) this.grow();
    const cap = this.ts.length;
    const tail = (this.head + this.count) % cap;
    this.ts[tail] = atNs;
    this.contrib[tail] = e;
    this.count++;
    this.sum += e;
  }

  private grow(): void {
    const cap = this.ts.length;
    const nextTs = new Float64Array(cap * 2);
    const nextContrib = new Float64Array(cap * 2);
    for (let i = 0; i < this.count; i++) {
      const src = (this.head + i) % cap;
      nextTs[i] = this.ts[src];
      nextContrib[i] = this.contrib[src];
    }
    this.head = 0;
    this.ts = nextTs;
    this.contrib = nextContrib;
  }
}

export class MultiLevelOfi {
  private readonly levels: WindowedOfi[];
  private readonly weights: Float64Array;

  constructor(depth: number, windowNs: number) {
    if (depth < 1) throw new Error(`MultiLevelOfi requires at least one level, got ${depth}`);
    this.levels = [];
    this.weights = new Float64Array(depth);
    for (let m = 0; m < depth; m++) {
      this.levels.push(new WindowedOfi(windowNs));
      this.weights[m] = 1 / (m + 1);
    }
  }

  update(
    atNs: number,
    bidTicks: ArrayLike<number>,
    bidSize: ArrayLike<number>,
    askTicks: ArrayLike<number>,
    askSize: ArrayLike<number>,
    count: number,
    offset = 0,
  ): number {
    let total = 0;
    for (let m = 0; m < this.levels.length && m < count; m++) {
      const v = this.levels[m].update(atNs, bidTicks[offset + m], bidSize[offset + m], askTicks[offset + m], askSize[offset + m]);
      total += this.weights[m] * v;
    }
    return total;
  }

  valueAsOf(atNs: number): number {
    let total = 0;
    for (let m = 0; m < this.levels.length; m++) total += this.weights[m] * this.levels[m].valueAsOf(atNs);
    return total;
  }
}

export function depthImbalance(bidSize: number, askSize: number): number {
  const total = bidSize + askSize;
  if (total === 0) return 0;
  return (bidSize - askSize) / total;
}
