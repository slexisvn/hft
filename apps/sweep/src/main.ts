import { readFileSync } from 'node:fs';
import { ConfigError, loadStrategyConfig, type AvellanedaParams, type EventColumns } from '@hft/contracts';
import { markout, midSeriesFromQuotes } from '@hft/metrics';
import { SimEngine } from '@hft/sim';
import { createStrategy } from '@hft/strategy';
import { LobsterMessageSource } from '@hft/lobster';

function main(): void {
  const configPath = process.argv[2] ?? 'configs/strategy.json';
  const config = loadStrategyConfig(readFileSync(configPath, 'utf8'));
  if (config.strategy.kind !== 'avellaneda_stoikov') {
    throw new ConfigError('sweep currently varies avellaneda_stoikov parameters only');
  }
  const base: AvellanedaParams = config.strategy;

  const source = new LobsterMessageSource({
    messagePath: config.input.messagePath,
    tickSize: config.instrument.tickSize,
    priceScale: config.instrument.priceScale,
    initialCapacity: config.sim.initialOrderCapacity,
  });
  const events: EventColumns = source.load();

  console.log('gamma,kappa,fills,pnl_ticks,inventory_end,markout_first_horizon_ticks');
  for (const gamma of config.sweep.gammaGrid) {
    for (const kappa of config.sweep.kappaGrid) {
      const params: AvellanedaParams = { ...base, gamma, kappa };
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
        createStrategy(params, null),
      );
      const result = engine.run(events);
      const series = midSeriesFromQuotes(result.quotes.timestampNs, result.quotes.bidTicks, result.quotes.askTicks);
      const mk = markout(result.fills, series, [config.metrics.markoutHorizonsNs[0]]);
      console.log(
        `${gamma},${kappa},${result.fills.length},${result.pnlTicks.toFixed(4)},${result.endPosition},${mk[0].meanTicks.toFixed(6)}`,
      );
    }
  }
}

main();
