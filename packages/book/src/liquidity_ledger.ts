import type { Side, Ticks } from '@hft/contracts';

function levelKey(side: Side, priceTicks: Ticks): number {
  return side * 0x40000000 + priceTicks;
}

export class LiquidityLedger {
  private time = -1;
  private readonly consumed = new Map<number, number>();

  resetAt(nowNs: number): void {
    if (nowNs !== this.time) {
      this.consumed.clear();
      this.time = nowNs;
    }
  }

  reservedAt(side: Side, priceTicks: Ticks): number {
    return this.consumed.get(levelKey(side, priceTicks)) ?? 0;
  }

  consume(side: Side, priceTicks: Ticks, qty: number): void {
    const key = levelKey(side, priceTicks);
    this.consumed.set(key, (this.consumed.get(key) ?? 0) + qty);
  }
}
