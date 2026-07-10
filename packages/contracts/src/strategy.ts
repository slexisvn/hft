import type { BookView } from './book';
import type { Gateway } from './gateway';
import type { FillRecord } from './schema';
import type { Clock } from './time';

export interface StrategyContext {
  readonly clock: Clock;
  readonly gateway: Gateway;
}

export interface Strategy {
  readonly name: string;
  onStart(ctx: StrategyContext): void;
  onMarketData(ctx: StrategyContext, view: BookView): void;
  onFill(ctx: StrategyContext, fill: FillRecord): void;
  onOrderRejected(ctx: StrategyContext, clientOrderId: string, reason: string): void;
  onStop(ctx: StrategyContext): void;
}
