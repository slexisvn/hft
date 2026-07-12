import type { BookView } from './book';
import type { Side, Ticks } from './enums';

export type OrderState = 'pending' | 'acked' | 'partial' | 'filled' | 'canceled' | 'rejected';

export interface OrderRequest {
  readonly clientOrderId: string;
  readonly side: Side;
  readonly priceTicks: Ticks;
  readonly size: number;
  readonly postOnly: boolean;
}

export interface OrderSnapshot {
  readonly clientOrderId: string;
  readonly side: Side;
  readonly priceTicks: Ticks;
  readonly size: number;
  readonly remaining: number;
  readonly state: OrderState;
}

export interface Gateway {
  submit(request: OrderRequest): void;
  cancel(clientOrderId: string): void;
  amend(clientOrderId: string, newSize: number): void;
  openOrders(): readonly OrderSnapshot[];
  position(): number;
  marketView(): BookView;
}

export interface OrderLifecycleSink {
  onAck(clientOrderId: string): void;
  onFill(clientOrderId: string, remaining: number): void;
  onCanceled(clientOrderId: string): void;
  onExchangeReject(clientOrderId: string): void;
  onPnlTicks(pnlTicks: number): void;
}

export type RiskGateway = Gateway & OrderLifecycleSink;
