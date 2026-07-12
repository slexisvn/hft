import { PREDICTOR_FEATURE_NAMES, assembleFeatureRecord, NO_PRICE, type FeatureRecord } from '@hft/contracts';
import { createFeaturePipeline, type MarketSnapshot } from './feature_registry';

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

  const depthLevels = quotes.depthLevels ?? 0;
  const hasDepth =
    depthLevels > 0 &&
    quotes.bidLevelTicks !== undefined &&
    quotes.bidLevelSize !== undefined &&
    quotes.askLevelTicks !== undefined &&
    quotes.askLevelSize !== undefined &&
    quotes.bidLevelCount !== undefined &&
    quotes.askLevelCount !== undefined;

  const pipeline = createFeaturePipeline(PREDICTOR_FEATURE_NAMES, {
    ofiWindowNs,
    depthLevels: hasDepth ? depthLevels : 0,
  });
  const values = new Float64Array(PREDICTOR_FEATURE_NAMES.length);

  let snapRow = 0;
  const snap: MarketSnapshot = {
    timestampNs: 0,
    bidTicks: 0,
    bidSize: 0,
    askTicks: 0,
    askSize: 0,
    depthLevels: hasDepth ? depthLevels : 0,
    bidDepthCount: 0,
    askDepthCount: 0,
    bidLevelTicks: (m) => quotes.bidLevelTicks![snapRow * depthLevels + m],
    bidLevelSize: (m) => quotes.bidLevelSize![snapRow * depthLevels + m],
    askLevelTicks: (m) => quotes.askLevelTicks![snapRow * depthLevels + m],
    askLevelSize: (m) => quotes.askLevelSize![snapRow * depthLevels + m],
  };

  let tradeIdx = 0;
  let gridTime = Math.ceil(quotes.timestampNs[0] / gridIntervalNs) * gridIntervalNs;

  let bid = NO_PRICE;
  let ask = NO_PRICE;

  for (let i = 0; i < n; i++) {
    const ts = quotes.timestampNs[i];
    while (gridTime <= ts && bid !== NO_PRICE && ask !== NO_PRICE) {
      while (tradeIdx < trades.timestampNs.length && trades.timestampNs[tradeIdx] <= gridTime) {
        pipeline.onTrade(trades.sign[tradeIdx]);
        tradeIdx++;
      }
      const mid = (bid + ask) / 2;
      pipeline.read(values, gridTime);
      out.push(assembleFeatureRecord(gridTime, mid, values));
      gridTime += gridIntervalNs;
    }
    if (gridTime <= ts) gridTime = Math.ceil((ts + 1) / gridIntervalNs) * gridIntervalNs;

    bid = quotes.bidTicks[i];
    ask = quotes.askTicks[i];
    snapRow = i;
    snap.timestampNs = ts;
    snap.bidTicks = bid;
    snap.bidSize = quotes.bidSize[i];
    snap.askTicks = ask;
    snap.askSize = quotes.askSize[i];
    if (hasDepth) {
      snap.bidDepthCount = quotes.bidLevelCount![i];
      snap.askDepthCount = quotes.askLevelCount![i];
    }
    pipeline.update(snap);
  }
  return out;
}
