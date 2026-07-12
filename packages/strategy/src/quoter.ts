import { SIDE_ASK, SIDE_BID, type Gateway, type Side, type Ticks } from '@hft/contracts';

export type ClientOrderIdFactory = (side: Side, seq: number) => string;

export function defaultIdFactory(prefix: string): ClientOrderIdFactory {
  return (side: Side, seq: number) => `${prefix}-${side}-${seq}`;
}

interface Quote {
  clientOrderId: string;
  priceTicks: Ticks;
  remaining: number;
}

export class TwoSidedQuoter {
  private readonly idFactory: ClientOrderIdFactory;
  private readonly requoteThresholdTicks: number;
  private readonly quotes: (Quote | null)[] = [null, null];
  private seq = 0;

  constructor(idFactory: ClientOrderIdFactory, requoteThresholdTicks: number) {
    this.idFactory = idFactory;
    this.requoteThresholdTicks = requoteThresholdTicks;
  }

  currentPrice(side: Side): Ticks | null {
    const q = this.quotes[side];
    return q === null ? null : q.priceTicks;
  }

  desire(gateway: Gateway, side: Side, priceTicks: Ticks, size: number): void {
    const current = this.quotes[side];
    if (current !== null && Math.abs(current.priceTicks - priceTicks) < this.requoteThresholdTicks) {
      if (size < current.remaining) {
        gateway.amend(current.clientOrderId, size);
        current.remaining = size;
      }
      return;
    }
    if (current !== null) {
      gateway.cancel(current.clientOrderId);
      this.quotes[side] = null;
    }
    const clientOrderId = this.idFactory(side, this.seq++);
    gateway.submit({ clientOrderId, side, priceTicks, size, postOnly: true });
    this.quotes[side] = { clientOrderId, priceTicks, remaining: size };
  }

  withdraw(gateway: Gateway, side: Side): void {
    const current = this.quotes[side];
    if (current === null) return;
    gateway.cancel(current.clientOrderId);
    this.quotes[side] = null;
  }

  desireWithinPosition(
    gateway: Gateway,
    side: Side,
    priceTicks: Ticks,
    size: number,
    position: number,
    maxPosition: number,
  ): void {
    let workingOnSide = 0;
    for (const o of gateway.openOrders()) {
      if (o.side === side && o.clientOrderId !== this.quotes[side]?.clientOrderId) workingOnSide += o.remaining;
    }
    const exposure = size + workingOnSide;
    const after = side === SIDE_BID ? position + exposure : position - exposure;
    if (Math.abs(after) > maxPosition) {
      this.withdraw(gateway, side);
      return;
    }
    this.desire(gateway, side, priceTicks, size);
  }

  withdrawAll(gateway: Gateway): void {
    this.withdraw(gateway, SIDE_BID);
    this.withdraw(gateway, SIDE_ASK);
  }

  onFill(clientOrderId: string, size: number): void {
    for (const side of [SIDE_BID, SIDE_ASK] as Side[]) {
      const q = this.quotes[side];
      if (q !== null && q.clientOrderId === clientOrderId) {
        q.remaining -= size;
        if (q.remaining <= 0) this.quotes[side] = null;
        return;
      }
    }
  }

  onRejected(clientOrderId: string): void {
    for (const side of [SIDE_BID, SIDE_ASK] as Side[]) {
      const q = this.quotes[side];
      if (q !== null && q.clientOrderId === clientOrderId) this.quotes[side] = null;
    }
  }
}
