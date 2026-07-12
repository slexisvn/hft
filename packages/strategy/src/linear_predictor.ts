import {
  ConfigError,
  NO_PRICE,
  SIDE_ASK,
  SIDE_BID,
  type BookView,
  type FillRecord,
  type LinearModelArtifact,
  type LinearParams,
  type Predictor,
  type Strategy,
  type StrategyContext,
} from '@hft/contracts';
import { WindowedOfi, depthImbalance } from '@hft/metrics';
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

export type FeatureName = 'ofi' | 'depth_imbalance' | 'spread_ticks' | 'micro_price_offset';

export function assertKnownFeatures(names: readonly string[]): FeatureName[] {
  const known: readonly string[] = ['ofi', 'depth_imbalance', 'spread_ticks', 'micro_price_offset'];
  for (const n of names) {
    if (known.indexOf(n) < 0) throw new ConfigError(`unknown feature "${n}", known: [${known.join(', ')}]`);
  }
  return names as FeatureName[];
}

export class LinearSignalStrategy implements Strategy {
  readonly name = 'linear';
  private readonly params: LinearParams;
  private readonly predictor: Predictor;
  private readonly featureNames: FeatureName[];
  private readonly features: Float64Array;
  private readonly ofi: WindowedOfi;
  private readonly quoter: TwoSidedQuoter;

  constructor(
    params: LinearParams,
    model: LinearModelArtifact,
    ofiWindowNs: number,
    idFactory: ClientOrderIdFactory = defaultIdFactory('lin'),
  ) {
    this.params = params;
    this.ofi = new WindowedOfi(ofiWindowNs);
    this.featureNames = assertKnownFeatures(params.features);
    if (model.inputs.length !== this.featureNames.length) {
      throw new ConfigError(`model expects ${model.inputs.length} inputs but config lists ${this.featureNames.length}`);
    }
    for (let i = 0; i < model.inputs.length; i++) {
      if (model.inputs[i] !== this.featureNames[i]) {
        throw new ConfigError(`model input ${i} is "${model.inputs[i]}" but config lists "${this.featureNames[i]}"`);
      }
    }
    this.predictor = createLinearPredictor(model);
    this.features = new Float64Array(this.featureNames.length);
    this.quoter = new TwoSidedQuoter(idFactory, params.requoteThresholdTicks);
  }

  onStart(): void {}

  onMarketData(ctx: StrategyContext, view: BookView): void {
    const bid = view.bestBidTicks();
    const ask = view.bestAskTicks();
    if (bid === NO_PRICE || ask === NO_PRICE) return;
    const bidSize = view.sizeAt(SIDE_BID, bid);
    const askSize = view.sizeAt(SIDE_ASK, ask);
    const ofi = this.ofi.update(ctx.clock.now(), bid, bidSize, ask, askSize);
    const mid = (bid + ask) / 2;

    for (let i = 0; i < this.featureNames.length; i++) {
      switch (this.featureNames[i]) {
        case 'ofi':
          this.features[i] = ofi;
          break;
        case 'depth_imbalance':
          this.features[i] = depthImbalance(bidSize, askSize);
          break;
        case 'spread_ticks':
          this.features[i] = ask - bid;
          break;
        case 'micro_price_offset':
          this.features[i] = view.microPriceTicks() - mid;
          break;
        default:
          this.features[i] = 0;
      }
    }

    const prediction = this.predictor(this.features)[0];
    const p = this.params;
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
