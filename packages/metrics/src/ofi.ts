import { NO_PRICE } from '@hft/contracts';

export class OfiAccumulator {
  private prevBid = NO_PRICE;
  private prevBidSize = 0;
  private prevAsk = NO_PRICE;
  private prevAskSize = 0;
  private started = false;
  private total = 0;

  get value(): number {
    return this.total;
  }

  reset(): void {
    this.total = 0;
  }

  update(bidTicks: number, bidSize: number, askTicks: number, askSize: number): number {
    if (!this.started) {
      this.started = true;
      this.prevBid = bidTicks;
      this.prevBidSize = bidSize;
      this.prevAsk = askTicks;
      this.prevAskSize = askSize;
      return 0;
    }
    let e = 0;
    if (bidTicks >= this.prevBid) e += bidSize;
    if (bidTicks <= this.prevBid) e -= this.prevBidSize;
    if (askTicks <= this.prevAsk) e -= askSize;
    if (askTicks >= this.prevAsk) e += this.prevAskSize;

    this.prevBid = bidTicks;
    this.prevBidSize = bidSize;
    this.prevAsk = askTicks;
    this.prevAskSize = askSize;
    this.total += e;
    return e;
  }
}

export function depthImbalance(bidSize: number, askSize: number): number {
  const total = bidSize + askSize;
  if (total === 0) return 0;
  return (bidSize - askSize) / total;
}
