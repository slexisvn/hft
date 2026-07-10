import type { Nanos } from './time';

export interface EventColumns {
  readonly length: number;
  readonly timestampNs: Float64Array;
  readonly eventType: Uint8Array;
  readonly side: Uint8Array;
  readonly orderId: Int32Array;
  readonly sizeQty: Int32Array;
  readonly priceTicks: Int32Array;
}

export interface MarketEvent {
  readonly timestampNs: Nanos;
  readonly eventType: number;
  readonly side: number;
  readonly orderId: number;
  readonly sizeQty: number;
  readonly priceTicks: number;
}

export interface MarketDataSource {
  readonly name: string;
  load(): EventColumns;
}
