import { SCHEMA_VERSION, type FeatureRecord, type LinearModelArtifact, type MetricsJson, type StrategyConfig } from '@hft/contracts';
import {
  buildFeatureGrid,
  fillRatio,
  inventorySummary,
  markout,
  markoutVsFillPrice,
  midSeriesFromQuotes,
  spreadSummary,
} from '@hft/metrics';
import { SimEngine, type SimResult } from '@hft/sim';
import { createStrategy } from '@hft/strategy';
import { LobsterMessageSource } from '@hft/lobster';

export interface BacktestArtifacts {
  readonly result: SimResult;
  readonly features: readonly FeatureRecord[];
  readonly metrics: MetricsJson;
}

export function runBacktest(config: StrategyConfig, model: LinearModelArtifact | null): BacktestArtifacts {
  const source = new LobsterMessageSource({
    messagePath: config.input.messagePath,
    tickSize: config.instrument.tickSize,
    priceScale: config.instrument.priceScale,
    initialCapacity: config.sim.initialOrderCapacity,
  });
  const events = source.load();

  const strategy = createStrategy(config.strategy, model);
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
    },
    strategy,
  );

  const result = engine.run(events);
  const features = buildFeatureGrid(result.quotes, result.trades, config.train.gridIntervalNs);

  let spreadSum = 0;
  for (const f of features) spreadSum += f.spreadTicks;
  const referenceHalfSpread = features.length === 0 ? 0 : spreadSum / features.length / 2;

  const midSeries = midSeriesFromQuotes(result.quotes.timestampNs, result.quotes.bidTicks, result.quotes.askTicks);
  const spreads = spreadSummary(result.fills, midSeries, config.metrics.realizedSpreadHorizonNs, referenceHalfSpread);
  const inv = inventorySummary(result.inventory);

  const metrics: MetricsJson = {
    schemaVersion: SCHEMA_VERSION,
    strategy: config.strategy.kind,
    markout: markout(result.fills, midSeries, config.metrics.markoutHorizonsNs),
    markoutVsFillPrice: markoutVsFillPrice(result.fills, midSeries, config.metrics.markoutHorizonsNs),
    effectiveSpreadTicksMean: spreads.effectiveSpreadTicksMean,
    realizedSpreadTicksMean: spreads.realizedSpreadTicksMean,
    priceImprovementTicksMean: spreads.priceImprovementTicksMean,
    fillRatio: fillRatio(result.fills.length, result.submissionCount),
    fillCount: result.fills.length,
    submissionCount: result.submissionCount,
    inventoryMean: inv.mean,
    inventoryMin: inv.min,
    inventoryMax: inv.max,
    inventoryEnd: inv.end,
    pnlTicks: result.pnlTicks,
  };

  return { result, features, metrics };
}
