import { SCHEMA_VERSION, type FeatureRecord, type LinearModelArtifact, type MetricsJson, type StrategyConfig } from '@hft/contracts';
import {
  buildFeatureGrid,
  fillRatio,
  impactRatioSummary,
  inventorySummary,
  markout,
  markoutBySide,
  markoutVsFillPrice,
  midSeriesFromQuotes,
  pnlRiskSummary,
  spreadSummary,
  timeWeightedInventory,
} from '@hft/metrics';
import { readFileSync } from 'node:fs';
import {
  SimEngine,
  constantLatency,
  empiricalLatency,
  lognormalLatency,
  type LatencySampler,
  type SimResult,
} from '@hft/sim';
import { Rng } from '@hft/numeric';
import { createStrategy } from '@hft/strategy';
import { buildGuardedGateway, riskLimits } from '@hft/live';
import { LobsterMessageSource } from '@hft/lobster';

function orderLatencySampler(config: StrategyConfig): LatencySampler {
  const median = config.latency.decisionNs + config.latency.orderEntryNs;
  const model = config.latency.orderModel;
  if (model === undefined || model.kind === 'constant') return constantLatency(median);
  const rng = new Rng(config.sim.seed);
  if (model.kind === 'lognormal') return lognormalLatency(median, model.sigma, rng);
  const samples = readFileSync(model.path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => Number(line));
  return empiricalLatency(samples, rng);
}

export interface BacktestArtifacts {
  readonly result: SimResult;
  readonly features: readonly FeatureRecord[];
  readonly metrics: MetricsJson;
  readonly haltReason: string | null;
}

export function runBacktest(config: StrategyConfig, model: LinearModelArtifact | null): BacktestArtifacts {
  const source = new LobsterMessageSource({
    messagePath: config.input.messagePath,
    tickSize: config.instrument.tickSize,
    priceScale: config.instrument.priceScale,
    initialCapacity: config.sim.initialOrderCapacity,
  });
  const events = source.load();

  const strategy = createStrategy(config.strategy, model, { ofiWindowNs: config.metrics.ofiWindowNs });
  let haltReason: string | null = null;
  const engine = new SimEngine(
    {
      minPriceTicks: config.instrument.minPriceTicks,
      maxPriceTicks: config.instrument.maxPriceTicks,
      initialOrderCapacity: config.sim.initialOrderCapacity,
      snapshotDepth: config.book.snapshotDepth,
      marketDataLatencyNs: config.latency.marketDataNs,
      decisionLatencyNs: config.latency.decisionNs,
      orderEntryLatencyNs: config.latency.orderEntryNs,
      makerFeeBps: config.sim.makerFeeBps,
      takerFeeBps: config.sim.takerFeeBps,
      inventorySampleIntervalNs: config.metrics.inventorySampleIntervalNs,
      orderLatencyNs: orderLatencySampler(config),
      sqrtImpactCoeff: config.sim.sqrtImpactCoeff,
    },
    strategy,
    (inner, clock, onReject) =>
      buildGuardedGateway(
        inner,
        clock,
        { limits: riskLimits(config.risk), rateLimit: config.live.rateLimit },
        {
          onOrderRejected: onReject,
          onHalted: (reason) => {
            if (haltReason === null) haltReason = reason;
          },
        },
      ),
  );

  const result = engine.run(events);
  const features = buildFeatureGrid(
    result.quotes,
    result.trades,
    config.train.gridIntervalNs,
    config.metrics.ofiWindowNs,
  );

  let spreadSum = 0;
  for (const f of features) spreadSum += f.spreadTicks;
  const referenceHalfSpread = features.length === 0 ? 0 : spreadSum / features.length / 2;

  const midSeries = midSeriesFromQuotes(result.quotes.timestampNs, result.quotes.bidTicks, result.quotes.askTicks);
  const spreads = spreadSummary(result.fills, midSeries, config.metrics.realizedSpreadHorizonNs, referenceHalfSpread);
  const inv = inventorySummary(result.inventory);
  const sides = markoutBySide(result.fills, midSeries, config.metrics.markoutHorizonsNs);
  const risk = pnlRiskSummary(result.inventoryPnlTicks);
  const impact = impactRatioSummary(result.fills);
  const impactThreshold = config.metrics.maxOrderDepthRatioP95;
  const selfImpactWarning = impactThreshold !== undefined && impact.p95 > impactThreshold;

  const metrics: MetricsJson = {
    schemaVersion: SCHEMA_VERSION,
    strategy: config.strategy.kind,
    markout: markout(result.fills, midSeries, config.metrics.markoutHorizonsNs),
    markoutVsFillPrice: markoutVsFillPrice(result.fills, midSeries, config.metrics.markoutHorizonsNs),
    markoutBid: sides.bid,
    markoutAsk: sides.ask,
    effectiveSpreadTicksMean: spreads.effectiveSpreadTicksMean,
    realizedSpreadTicksMean: spreads.realizedSpreadTicksMean,
    priceImprovementTicksMean: spreads.priceImprovementTicksMean,
    fillRatio: fillRatio(result.fills.length, result.submissionCount),
    fillCount: result.fills.length,
    submissionCount: result.submissionCount,
    inventoryMean: inv.mean,
    inventoryTimeWeightedMean: timeWeightedInventory(result.inventoryTimestampNs, result.inventory),
    inventoryMin: inv.min,
    inventoryMax: inv.max,
    inventoryEnd: inv.end,
    pnlTicks: result.pnlTicks,
    sharpePerStep: risk.sharpePerStep,
    sortinoPerStep: risk.sortinoPerStep,
    maxDrawdownTicks: risk.maxDrawdownTicks,
    orderDepthRatioP95: impact.p95,
    orderDepthRatioMax: impact.max,
    selfImpactWarning,
  };

  return { result, features, metrics, haltReason };
}
