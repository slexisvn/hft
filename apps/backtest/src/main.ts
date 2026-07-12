import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  FEATURES_SCHEMA,
  FILLS_SCHEMA,
  LINEAR_MODEL_SPEC,
  featureRow,
  fillRow,
  getTableSerializer,
  loadStrategyConfig,
  validate,
  type LinearModelArtifact,
} from '@hft/contracts';
import { runBacktest } from './pipeline';

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function main(): void {
  const configPath = process.argv[2] ?? 'configs/strategy.json';
  const config = loadStrategyConfig(readFileSync(configPath, 'utf8'));

  let model: LinearModelArtifact | null = null;
  if (config.strategy.kind === 'linear') {
    const raw = JSON.parse(readFileSync(config.strategy.modelPath, 'utf8')) as unknown;
    model = validate(LINEAR_MODEL_SPEC, raw) as LinearModelArtifact;
  }

  const { result, features, metrics, haltReason } = runBacktest(config, model);
  const serialize = getTableSerializer(config.output.format);

  ensureDir(config.output.fillsPath);
  writeFileSync(config.output.fillsPath, serialize(FILLS_SCHEMA, result.fills.map(fillRow)), 'utf8');
  ensureDir(config.output.featuresPath);
  writeFileSync(config.output.featuresPath, serialize(FEATURES_SCHEMA, features.map(featureRow)), 'utf8');
  ensureDir(config.output.metricsPath);
  writeFileSync(config.output.metricsPath, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');

  console.log(`events replayed        : ${result.quotes.timestampNs.length} quote changes`);
  console.log(`submissions            : ${metrics.submissionCount}`);
  console.log(`fills                  : ${metrics.fillCount}`);
  console.log(`fill ratio             : ${metrics.fillRatio.toFixed(4)}`);
  console.log(`kill switch halt       : ${haltReason ?? 'none'}`);
  console.log(`cancels raced by fill  : ${result.cancelRacedFillCount}`);
  console.log(`pnl (ticks)            : ${metrics.pnlTicks.toFixed(4)}`);
  console.log(`sharpe / sortino /step : ${metrics.sharpePerStep.toFixed(4)} / ${metrics.sortinoPerStep.toFixed(4)}`);
  console.log(`max drawdown (ticks)   : ${metrics.maxDrawdownTicks.toFixed(4)}`);
  console.log(`inventory end / twmean : ${metrics.inventoryEnd} / ${metrics.inventoryTimeWeightedMean.toFixed(4)}`);
  console.log(`order/depth p95 / max  : ${metrics.orderDepthRatioP95.toFixed(4)} / ${metrics.orderDepthRatioMax.toFixed(4)}`);
  if (metrics.selfImpactWarning) {
    console.log('warning: order size is large relative to book depth; fills assume no self-impact and are optimistic');
  }
  for (const m of metrics.markout) {
    console.log(`markout vs mid   @ ${m.horizonNs} ns : ${m.meanTicks.toFixed(6)} ticks (n=${m.count})`);
  }
  for (const m of metrics.markoutVsFillPrice) {
    console.log(`markout vs price @ ${m.horizonNs} ns : ${m.meanTicks.toFixed(6)} ticks (n=${m.count})`);
  }
  console.log(`features rows          : ${features.length}`);
  console.log(`wrote                  : ${config.output.fillsPath}, ${config.output.featuresPath}, ${config.output.metricsPath}`);
}

main();
