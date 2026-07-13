import { cashDeltaTicks, markToMarketTicks, positionDeltaQty, type Side } from '@hft/contracts';
import { numberAt, type TableRow } from './table';

const FILL_SIDE = 'side';
const FILL_PRICE_TICKS = 'price_ticks';
const FILL_SIZE = 'size';
const FILL_MID_TICKS = 'mid_ticks_at_fill';
const GROSS_FEE_BPS = 0;

export interface EquityPoint {
  readonly fill: number;
  readonly equityTicks: number;
  readonly drawdownTicks: number;
}

export function buildEquitySeries(fills: readonly TableRow[]): EquityPoint[] {
  const points: EquityPoint[] = [];
  let cashTicks = 0;
  let position = 0;
  let peak = 0;
  for (let i = 0; i < fills.length; i++) {
    const row = fills[i];
    const side = numberAt(row, FILL_SIDE) as Side;
    const priceTicks = numberAt(row, FILL_PRICE_TICKS);
    const size = numberAt(row, FILL_SIZE);
    const midTicks = numberAt(row, FILL_MID_TICKS);
    cashTicks += cashDeltaTicks(side, priceTicks, size, GROSS_FEE_BPS);
    position += positionDeltaQty(side, size);
    const equityTicks = markToMarketTicks(cashTicks, position, midTicks);
    peak = Math.max(peak, equityTicks);
    points.push({ fill: i + 1, equityTicks, drawdownTicks: equityTicks - peak });
  }
  return points;
}
