import { NO_PRICE, type FeatureRecord } from '@hft/contracts';
import { MultiLevelOfi, WindowedOfi, depthImbalance } from './ofi';

export interface QuoteColumns {
  readonly timestampNs: Float64Array;
  readonly bidTicks: Int32Array;
  readonly bidSize: Int32Array;
  readonly askTicks: Int32Array;
  readonly askSize: Int32Array;
  readonly depthLevels?: number;
  readonly bidLevelTicks?: Int32Array;
  readonly bidLevelSize?: Int32Array;
  readonly askLevelTicks?: Int32Array;
  readonly askLevelSize?: Int32Array;
  readonly bidLevelCount?: Int32Array;
  readonly askLevelCount?: Int32Array;
}

export interface TradeColumns {
  readonly timestampNs: Float64Array;
  readonly sign: Int32Array;
}

export function buildFeatureGrid(
  quotes: QuoteColumns,
  trades: TradeColumns,
  gridIntervalNs: number,
  ofiWindowNs: number,
): FeatureRecord[] {
  const out: FeatureRecord[] = [];
  const n = quotes.timestampNs.length;
  if (n === 0) return out;

  const ofi = new WindowedOfi(ofiWindowNs);
  const depthLevels = quotes.depthLevels ?? 0;
  const hasDepth =
    depthLevels > 0 &&
    quotes.bidLevelTicks !== undefined &&
    quotes.bidLevelSize !== undefined &&
    quotes.askLevelTicks !== undefined &&
    quotes.askLevelSize !== undefined &&
    quotes.bidLevelCount !== undefined &&
    quotes.askLevelCount !== undefined;
  const multiOfi = hasDepth ? new MultiLevelOfi(depthLevels, ofiWindowNs) : null;
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
        ofi: ofi.valueAsOf(gridTime),
        multiLevelOfi: multiOfi === null ? 0 : multiOfi.valueAsOf(gridTime),
        tradeSign: lastSign,
      });
      gridTime += gridIntervalNs;
    }
    if (gridTime <= ts) gridTime = Math.ceil((ts + 1) / gridIntervalNs) * gridIntervalNs;

    bid = quotes.bidTicks[i];
    bidSize = quotes.bidSize[i];
    ask = quotes.askTicks[i];
    askSize = quotes.askSize[i];
    if (bid !== NO_PRICE && ask !== NO_PRICE) ofi.update(ts, bid, bidSize, ask, askSize);
    if (multiOfi !== null) {
      multiOfi.update(
        ts,
        quotes.bidLevelTicks!,
        quotes.bidLevelSize!,
        quotes.askLevelTicks!,
        quotes.askLevelSize!,
        Math.min(quotes.bidLevelCount![i], quotes.askLevelCount![i]),
        i * depthLevels,
      );
    }
  }
  return out;
}
