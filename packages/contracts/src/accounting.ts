import { SIDE_BID, type Side } from './enums';

export function cashDeltaTicks(side: Side, priceTicks: number, qty: number, feeBps: number): number {
  const notional = priceTicks * qty;
  return (side === SIDE_BID ? -notional : notional) - (notional * feeBps) / 10000;
}

export function positionDeltaQty(side: Side, qty: number): number {
  return side === SIDE_BID ? qty : -qty;
}

export function markToMarketTicks(cashTicks: number, position: number, midTicks: number): number {
  return Number.isFinite(midTicks) ? cashTicks + position * midTicks : cashTicks;
}
