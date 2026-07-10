import { NO_PRICE, type FeatureRecord } from '@hft/contracts';
import { OfiAccumulator, depthImbalance } from './ofi';

export interface QuoteColumns {
  readonly timestampNs: Float64Array;
  readonly bidTicks: Int32Array;
  readonly bidSize: Int32Array;
  readonly askTicks: Int32Array;
  readonly askSize: Int32Array;
}

export interface TradeColumns {
  readonly timestampNs: Float64Array;
  readonly sign: Int32Array;
}

export function buildFeatureGrid(
  quotes: QuoteColumns,
  trades: TradeColumns,
  gridIntervalNs: number,
): FeatureRecord[] {
  const out: FeatureRecord[] = [];
  const n = quotes.timestampNs.length;
  if (n === 0) return out;

  const ofi = new OfiAccumulator();
  let tradeIdx = 0;
  let lastSign = 0;
  let gridTime = Math.ceil(quotes.timestampNs[0] / gridIntervalNs) * gridIntervalNs;

  let bid = NO_PRICE;
  let bidSize = 0;
  let ask = NO_PRICE;
  let askSize = 0;

  for (let i = 0; i < n; i++) {
    const ts = quotes.timestampNs[i];
    while (gridTime <= ts && bid !== NO_PRICE && ask !== NO_PRICE) {
      while (tradeIdx < trades.timestampNs.length && trades.timestampNs[tradeIdx] <= gridTime) {
        lastSign = trades.sign[tradeIdx];
        tradeIdx++;
      }
      const mid = (bid + ask) / 2;
      const total = bidSize + askSize;
      out.push({
        timestampNs: gridTime,
        midTicks: mid,
        microPriceTicks: total === 0 ? mid : (bid * askSize + ask * bidSize) / total,
        spreadTicks: ask - bid,
        bidSize,
        askSize,
        depthImbalance: depthImbalance(bidSize, askSize),
        ofi: ofi.value,
        tradeSign: lastSign,
      });
      ofi.reset();
      gridTime += gridIntervalNs;
    }
    if (gridTime <= ts) gridTime = Math.ceil((ts + 1) / gridIntervalNs) * gridIntervalNs;

    bid = quotes.bidTicks[i];
    bidSize = quotes.bidSize[i];
    ask = quotes.askTicks[i];
    askSize = quotes.askSize[i];
    if (bid !== NO_PRICE && ask !== NO_PRICE) ofi.update(bid, bidSize, ask, askSize);
  }
  return out;
}
