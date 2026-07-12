import {
  ConfigError,
  NO_PRICE,
  PREDICTOR_FEATURE_NAMES,
  SIDE_ASK,
  SIDE_BID,
  type BookView,
  type FeatureName,
  type FillRecord,
  type LevelView,
  type LinearModelArtifact,
  type LinearParams,
  type Predictor,
  type Strategy,
  type StrategyContext,
} from '@hft/contracts';
import { createFeaturePipeline, type FeaturePipeline, type MarketSnapshot } from '@hft/metrics';
import { TwoSidedQuoter, defaultIdFactory, type ClientOrderIdFactory } from './quoter';

export function createLinearPredictor(model: LinearModelArtifact): Predictor {
  const inputs = model.inputs.length;
  const outputs = model.outputs.length;
  if (model.weights.length !== inputs * outputs) {
    throw new ConfigError(`linear model has ${model.weights.length} weights, expected ${inputs * outputs}`);
  }
  if (model.intercept.length !== outputs) {
    throw new ConfigError(`linear model has ${model.intercept.length} intercepts, expected ${outputs}`);
  }
  const w = Float64Array.from(model.weights);
  const b = Float64Array.from(model.intercept);
  const out = new Float64Array(outputs);
  return (features: Float64Array): Float64Array => {
    if (features.length !== inputs) {
      throw new ConfigError(`predictor expects ${inputs} features, got ${features.length}`);
    }
    for (let o = 0; o < outputs; o++) {
      let s = b[o];
      const base = o * inputs;
      for (let i = 0; i < inputs; i++) s += w[base + i] * features[i];
      out[o] = s;
    }
    return out;
  };
}

export function assertKnownFeatures(names: readonly string[]): FeatureName[] {
  const known = PREDICTOR_FEATURE_NAMES as readonly string[];
  for (const n of names) {
    if (known.indexOf(n) < 0) throw new ConfigError(`unknown feature "${n}", known: [${known.join(', ')}]`);
  }
  return names as FeatureName[];
}

function levelScratch(depth: number): LevelView[] {
  const out: LevelView[] = [];
  for (let i = 0; i < depth; i++) out.push({ priceTicks: 0, size: 0, orderCount: 0 });
  return out;
}

export class LinearSignalStrategy implements Strategy {
  readonly name = 'linear';
  private readonly params: LinearParams;
  private readonly predictor: Predictor;
  private readonly featureNames: FeatureName[];
  private readonly features: Float64Array;
  private readonly pipeline: FeaturePipeline;
  private readonly needsDepth: boolean;
  private readonly snapshotDepth: number;
  private readonly bidLevels: LevelView[];
  private readonly askLevels: LevelView[];
  private readonly snap: MarketSnapshot;
  private readonly quoter: TwoSidedQuoter;

  constructor(
    params: LinearParams,
    model: LinearModelArtifact,
    ofiWindowNs: number,
    snapshotDepth: number,
    idFactory: ClientOrderIdFactory = defaultIdFactory('lin'),
  ) {
    this.params = params;
    this.featureNames = assertKnownFeatures(params.features);
    if (model.inputs.length !== this.featureNames.length) {
      throw new ConfigError(`model expects ${model.inputs.length} inputs but config lists ${this.featureNames.length}`);
    }
    for (let i = 0; i < model.inputs.length; i++) {
      if (model.inputs[i] !== this.featureNames[i]) {
        throw new ConfigError(`model input ${i} is "${model.inputs[i]}" but config lists "${this.featureNames[i]}"`);
      }
    }
    this.needsDepth = this.featureNames.indexOf('multi_level_ofi') >= 0;
    if (this.needsDepth && snapshotDepth < 1) {
      throw new ConfigError('feature "multi_level_ofi" requires book.snapshotDepth >= 1');
    }
    this.snapshotDepth = snapshotDepth;
    this.predictor = createLinearPredictor(model);
    this.pipeline = createFeaturePipeline(this.featureNames, { ofiWindowNs, depthLevels: snapshotDepth });
    this.features = new Float64Array(this.featureNames.length);
    this.bidLevels = levelScratch(snapshotDepth);
    this.askLevels = levelScratch(snapshotDepth);
    const bidLevels = this.bidLevels;
    const askLevels = this.askLevels;
    this.snap = {
      timestampNs: 0,
      bidTicks: 0,
      bidSize: 0,
      askTicks: 0,
      askSize: 0,
      depthLevels: snapshotDepth,
      bidDepthCount: 0,
      askDepthCount: 0,
      bidLevelTicks: (m) => bidLevels[m].priceTicks,
      bidLevelSize: (m) => bidLevels[m].size,
      askLevelTicks: (m) => askLevels[m].priceTicks,
      askLevelSize: (m) => askLevels[m].size,
    };
    this.quoter = new TwoSidedQuoter(idFactory, params.requoteThresholdTicks);
  }

  onStart(): void {}

  onMarketData(ctx: StrategyContext, view: BookView): void {
    const bid = view.bestBidTicks();
    const ask = view.bestAskTicks();
    if (bid === NO_PRICE || ask === NO_PRICE) return;
    const bidSize = view.sizeAt(SIDE_BID, bid);
    const askSize = view.sizeAt(SIDE_ASK, ask);
    const now = ctx.clock.now();

    this.snap.timestampNs = now;
    this.snap.bidTicks = bid;
    this.snap.bidSize = bidSize;
    this.snap.askTicks = ask;
    this.snap.askSize = askSize;
    if (this.needsDepth) {
      this.snap.bidDepthCount = view.depth(SIDE_BID, this.snapshotDepth, this.bidLevels);
      this.snap.askDepthCount = view.depth(SIDE_ASK, this.snapshotDepth, this.askLevels);
    }
    this.pipeline.update(this.snap);
    this.pipeline.read(this.features, now);

    const prediction = this.predictor(this.features)[0];
    const p = this.params;
    const mid = (bid + ask) / 2;
    const skew = Math.abs(prediction) < p.entryThreshold ? 0 : prediction * p.skewTicksPerUnit;
    const center = mid + skew;

    let quoteBid = Math.floor(center - p.baseHalfSpreadTicks);
    let quoteAsk = Math.ceil(center + p.baseHalfSpreadTicks);
    if (quoteAsk <= quoteBid) quoteAsk = quoteBid + 1;
    if (quoteBid >= ask) quoteBid = ask - 1;
    if (quoteAsk <= bid) quoteAsk = bid + 1;

    const inventory = ctx.gateway.position();
    this.quoter.desireWithinPosition(ctx.gateway, SIDE_BID, quoteBid, p.orderSize, inventory, p.maxPosition);
    this.quoter.desireWithinPosition(ctx.gateway, SIDE_ASK, quoteAsk, p.orderSize, inventory, p.maxPosition);
  }

  onTrade(_ctx: StrategyContext, sign: number): void {
    this.pipeline.onTrade(sign);
  }

  onFill(_ctx: StrategyContext, fill: FillRecord): void {
    this.quoter.onFill(fill.clientOrderId, fill.size);
  }

  onOrderRejected(_ctx: StrategyContext, clientOrderId: string): void {
    this.quoter.onRejected(clientOrderId);
  }

  onStop(ctx: StrategyContext): void {
    this.quoter.withdrawAll(ctx.gateway);
  }
}
