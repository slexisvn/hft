import { NO_PRICE, microPriceTicksOf, type FeatureName } from '@hft/contracts';
import { MultiLevelOfi, WindowedOfi, depthImbalance } from './ofi';

const ZERO_EXTRACTOR: FeatureExtractor = {
  update(): void {},
  onTrade(): void {},
  value(): number {
    return 0;
  },
};

export interface MarketSnapshot {
  timestampNs: number;
  bidTicks: number;
  bidSize: number;
  askTicks: number;
  askSize: number;
  depthLevels: number;
  bidDepthCount: number;
  askDepthCount: number;
  bidLevelTicks(m: number): number;
  bidLevelSize(m: number): number;
  askLevelTicks(m: number): number;
  askLevelSize(m: number): number;
}

export interface FeatureExtractor {
  update(m: MarketSnapshot): void;
  onTrade(sign: number): void;
  value(nowNs: number): number;
}

export interface FeatureParams {
  ofiWindowNs: number;
  depthLevels: number;
}

interface BookState {
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
}

function bookExtractor(read: (s: BookState) => number): FeatureExtractor {
  const s: BookState = { bid: 0, bidSize: 0, ask: 0, askSize: 0 };
  return {
    update(m: MarketSnapshot): void {
      s.bid = m.bidTicks;
      s.bidSize = m.bidSize;
      s.ask = m.askTicks;
      s.askSize = m.askSize;
    },
    onTrade(): void {},
    value(): number {
      return read(s);
    },
  };
}

function microPriceExtractor(): FeatureExtractor {
  return bookExtractor((s) => microPriceTicksOf(s.bid, s.ask, s.bidSize, s.askSize));
}

function spreadExtractor(): FeatureExtractor {
  return bookExtractor((s) => s.ask - s.bid);
}

function bidSizeExtractor(): FeatureExtractor {
  return bookExtractor((s) => s.bidSize);
}

function askSizeExtractor(): FeatureExtractor {
  return bookExtractor((s) => s.askSize);
}

function depthImbalanceExtractor(): FeatureExtractor {
  return bookExtractor((s) => depthImbalance(s.bidSize, s.askSize));
}

function ofiExtractor(p: FeatureParams): FeatureExtractor {
  const ofi = new WindowedOfi(p.ofiWindowNs);
  return {
    update(m: MarketSnapshot): void {
      if (m.bidTicks === NO_PRICE || m.askTicks === NO_PRICE) return;
      ofi.update(m.timestampNs, m.bidTicks, m.bidSize, m.askTicks, m.askSize);
    },
    onTrade(): void {},
    value(nowNs: number): number {
      return ofi.valueAsOf(nowNs);
    },
  };
}

function multiLevelOfiExtractor(p: FeatureParams): FeatureExtractor {
  if (p.depthLevels < 1) return ZERO_EXTRACTOR;
  const depth = p.depthLevels;
  const multi = new MultiLevelOfi(depth, p.ofiWindowNs);
  const bidTicks = new Float64Array(depth);
  const bidSize = new Float64Array(depth);
  const askTicks = new Float64Array(depth);
  const askSize = new Float64Array(depth);
  return {
    update(m: MarketSnapshot): void {
      for (let i = 0; i < depth; i++) {
        bidTicks[i] = m.bidLevelTicks(i);
        bidSize[i] = m.bidLevelSize(i);
        askTicks[i] = m.askLevelTicks(i);
        askSize[i] = m.askLevelSize(i);
      }
      multi.update(m.timestampNs, bidTicks, bidSize, askTicks, askSize, Math.min(m.bidDepthCount, m.askDepthCount), 0);
    },
    onTrade(): void {},
    value(nowNs: number): number {
      return multi.valueAsOf(nowNs);
    },
  };
}

function tradeSignExtractor(): FeatureExtractor {
  let sign = 0;
  return {
    update(): void {},
    onTrade(s: number): void {
      sign = s;
    },
    value(): number {
      return sign;
    },
  };
}

export const featureExtractors: Readonly<Record<FeatureName, (p: FeatureParams) => FeatureExtractor>> = Object.freeze({
  micro_price_ticks: microPriceExtractor,
  spread_ticks: spreadExtractor,
  bid_size: bidSizeExtractor,
  ask_size: askSizeExtractor,
  depth_imbalance: depthImbalanceExtractor,
  ofi: ofiExtractor,
  multi_level_ofi: multiLevelOfiExtractor,
  trade_sign: tradeSignExtractor,
});

export interface FeaturePipeline {
  update(m: MarketSnapshot): void;
  onTrade(sign: number): void;
  read(out: Float64Array, nowNs: number): void;
}

export function createFeaturePipeline(names: readonly FeatureName[], params: FeatureParams): FeaturePipeline {
  const extractors = names.map((n) => featureExtractors[n](params));
  return {
    update(m: MarketSnapshot): void {
      for (let i = 0; i < extractors.length; i++) extractors[i].update(m);
    },
    onTrade(sign: number): void {
      for (let i = 0; i < extractors.length; i++) extractors[i].onTrade(sign);
    },
    read(out: Float64Array, nowNs: number): void {
      for (let i = 0; i < extractors.length; i++) out[i] = extractors[i].value(nowNs);
    },
  };
}
