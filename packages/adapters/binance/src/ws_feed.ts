import { priceToTicks, type TickScale } from '@hft/events';
import type { BinanceDepthUpdate, ExecutionReport, ExecutionStatus } from './transport';

export interface BinanceFeedTarget {
  onDepthUpdate(update: BinanceDepthUpdate): unknown;
  onTrade(timestampNs: number, priceTicks: number, size: number, buyerIsMaker: boolean): void;
  onExecutionReport(report: ExecutionReport): void;
}

interface RawMessage {
  readonly e?: string;
  readonly data?: RawMessage;
  readonly [key: string]: unknown;
}

const MS_TO_NS = 1_000_000;

export function parseDepthUpdate(msg: Record<string, unknown>): BinanceDepthUpdate {
  return {
    firstUpdateId: Number(msg.U),
    finalUpdateId: Number(msg.u),
    bids: (msg.b as (readonly [string, string])[]) ?? [],
    asks: (msg.a as (readonly [string, string])[]) ?? [],
  };
}

export function parseExecutionReport(msg: Record<string, unknown>, scale: TickScale): ExecutionReport {
  const origQty = Number(msg.q);
  const cumQty = Number(msg.z);
  const lastPrice = Number(msg.L);
  return {
    clientOrderId: String(msg.c),
    status: String(msg.X) as ExecutionStatus,
    transactTimeNs: Number(msg.T) * MS_TO_NS,
    lastFilledQty: Number(msg.l),
    lastFilledPriceTicks: lastPrice > 0 ? priceToTicks(scale, lastPrice) : 0,
    remainingQty: origQty - cumQty,
    isMaker: msg.m === true,
  };
}

export function dispatchFeedMessage(raw: string, target: BinanceFeedTarget, scale: TickScale): void {
  const outer = JSON.parse(raw) as RawMessage;
  const msg = outer.data ?? outer;
  switch (msg.e) {
    case 'depthUpdate':
      target.onDepthUpdate(parseDepthUpdate(msg));
      return;
    case 'trade':
      target.onTrade(
        Number(msg.T) * MS_TO_NS,
        priceToTicks(scale, Number(msg.p)),
        Number(msg.q),
        msg.m === true,
      );
      return;
    case 'executionReport':
      target.onExecutionReport(parseExecutionReport(msg, scale));
      return;
    default:
      return;
  }
}
