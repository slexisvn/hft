import { fillFromExecution } from '@hft/book';

export { isMarketable, takerWalk } from '@hft/book';
export type { TakerSlice } from '@hft/book';

export function makerFillQty(aheadBefore: number, executedSize: number, remaining: number): number {
  return fillFromExecution(aheadBefore, executedSize, remaining);
}
