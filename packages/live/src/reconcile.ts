import type { OrderSnapshot } from '@hft/contracts';

export interface AccountSnapshot {
  readonly position: number;
  readonly openOrders: readonly OrderSnapshot[];
}

export interface ReconcileResult {
  readonly positionDrift: number;
  readonly missingRemotely: readonly string[];
  readonly missingLocally: readonly string[];
  readonly priceMismatches: readonly string[];
  readonly breach: boolean;
}

export function reconcile(local: AccountSnapshot, remote: AccountSnapshot, toleranceQty: number): ReconcileResult {
  const positionDrift = local.position - remote.position;

  const localById = new Map<string, OrderSnapshot>();
  for (const o of local.openOrders) localById.set(o.clientOrderId, o);
  const remoteById = new Map<string, OrderSnapshot>();
  for (const o of remote.openOrders) remoteById.set(o.clientOrderId, o);

  const missingRemotely: string[] = [];
  const priceMismatches: string[] = [];
  for (const [id, lo] of localById) {
    const ro = remoteById.get(id);
    if (ro === undefined) {
      missingRemotely.push(id);
      continue;
    }
    if (ro.priceTicks !== lo.priceTicks || ro.side !== lo.side) priceMismatches.push(id);
  }

  const missingLocally: string[] = [];
  for (const id of remoteById.keys()) {
    if (!localById.has(id)) missingLocally.push(id);
  }

  const breach =
    Math.abs(positionDrift) > toleranceQty ||
    missingRemotely.length > 0 ||
    missingLocally.length > 0 ||
    priceMismatches.length > 0;

  return { positionDrift, missingRemotely, missingLocally, priceMismatches, breach };
}
