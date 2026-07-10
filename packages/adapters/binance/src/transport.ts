import type { OrderRequest } from '@hft/contracts';

export interface OrderTransport {
  readonly name: string;
  sendOrder(request: OrderRequest): void;
  cancelOrder(clientOrderId: string): void;
}

export type ExecutionStatus = 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'REJECTED' | 'EXPIRED';

export interface ExecutionReport {
  readonly clientOrderId: string;
  readonly status: ExecutionStatus;
  readonly transactTimeNs: number;
  readonly lastFilledQty: number;
  readonly lastFilledPriceTicks: number;
  readonly remainingQty: number;
  readonly isMaker: boolean;
}

export interface BinanceDepthUpdate {
  readonly firstUpdateId: number;
  readonly finalUpdateId: number;
  readonly bids: readonly (readonly [string, string])[];
  readonly asks: readonly (readonly [string, string])[];
}

export interface DepthSnapshot {
  readonly lastUpdateId: number;
  readonly bids: readonly (readonly [string, string])[];
  readonly asks: readonly (readonly [string, string])[];
}
