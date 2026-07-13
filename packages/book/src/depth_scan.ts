import { NO_PRICE, SIDE_BID, type LevelView, type Side } from '@hft/contracts';

export function scanDepth(
  side: Side,
  levels: number,
  out: LevelView[],
  bestBid: number,
  bestAsk: number,
  minPriceTicks: number,
  maxPriceTicks: number,
  base: number,
  size: Int32Array,
  orders?: Int32Array,
): number {
  let found = 0;
  if (side === SIDE_BID) {
    if (bestBid === NO_PRICE) return 0;
    for (let t = bestBid; t >= minPriceTicks && found < levels; t--) {
      const s = size[base + (t - minPriceTicks)];
      if (s > 0) {
        out[found].priceTicks = t;
        out[found].size = s;
        out[found].orderCount = orders ? orders[base + (t - minPriceTicks)] : 0;
        found++;
      }
    }
    return found;
  }
  if (bestAsk === NO_PRICE) return 0;
  for (let t = bestAsk; t <= maxPriceTicks && found < levels; t++) {
    const s = size[base + (t - minPriceTicks)];
    if (s > 0) {
      out[found].priceTicks = t;
      out[found].size = s;
      out[found].orderCount = orders ? orders[base + (t - minPriceTicks)] : 0;
      found++;
    }
  }
  return found;
}
