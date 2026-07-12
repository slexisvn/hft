import { SIDE_ASK, SIDE_BID, type OrderSnapshot, type OrderState, type Side } from '@hft/contracts';
import { priceToTicks, type TickScale } from '@hft/events';

export interface AccountSnapshot {
  readonly position: number;
  readonly openOrders: readonly OrderSnapshot[];
}

const STATUS_TO_STATE: Readonly<Record<string, OrderState>> = {
  NEW: 'acked',
  PARTIALLY_FILLED: 'partial',
  FILLED: 'filled',
  CANCELED: 'canceled',
  REJECTED: 'rejected',
  EXPIRED: 'canceled',
};

export function parseOpenOrders(json: string, scale: TickScale): OrderSnapshot[] {
  const rows = JSON.parse(json) as Record<string, unknown>[];
  const out: OrderSnapshot[] = [];
  for (const row of rows) {
    const origQty = Number(row.origQty);
    const executedQty = Number(row.executedQty);
    const side: Side = row.side === 'BUY' ? SIDE_BID : SIDE_ASK;
    out.push({
      clientOrderId: String(row.clientOrderId),
      side,
      priceTicks: priceToTicks(scale, Number(row.price)),
      size: origQty,
      remaining: origQty - executedQty,
      state: STATUS_TO_STATE[String(row.status)] ?? 'acked',
    });
  }
  return out;
}

export function parseBaseAssetPosition(accountJson: string, baseAsset: string): number {
  const account = JSON.parse(accountJson) as { balances?: Record<string, unknown>[] };
  for (const balance of account.balances ?? []) {
    if (balance.asset === baseAsset) return Number(balance.free) + Number(balance.locked);
  }
  return 0;
}

export function parseAccountSnapshot(
  accountJson: string,
  openOrdersJson: string,
  scale: TickScale,
  baseAsset: string,
): AccountSnapshot {
  return {
    position: parseBaseAssetPosition(accountJson, baseAsset),
    openOrders: parseOpenOrders(openOrdersJson, scale),
  };
}

export class SnapshotCache<T> {
  private value: T | null = null;
  private updatedAtNs = -1;

  set(value: T, atNs: number): void {
    this.value = value;
    this.updatedAtNs = atNs;
  }

  get(): T | null {
    return this.value;
  }

  require(): T {
    if (this.value === null) throw new Error('snapshot cache is empty: no account snapshot has been fetched yet');
    return this.value;
  }

  ageNs(nowNs: number): number {
    return this.updatedAtNs < 0 ? Number.POSITIVE_INFINITY : nowNs - this.updatedAtNs;
  }
}
