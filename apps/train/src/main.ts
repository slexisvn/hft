import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ConfigError, SCHEMA_VERSION, columnIndex, loadStrategyConfig, parseCsv, type LinearModelArtifact } from '@hft/contracts';
import {
  informationCoefficient,
  predict,
  rSquared,
  ridgeFit,
  splitRows,
  standardize,
  toRawSpace,
  type DesignMatrix,
  type Standardization,
} from '@hft/numeric';

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function identity(cols: number): Standardization {
  const mean = new Float64Array(cols);
  const scale = new Float64Array(cols).fill(1);
  return { mean, scale };
}

function score(x: DesignMatrix, y: Float64Array, weights: Float64Array, intercept: number): { r2: number; ic: number } {
  const yhat = predict(x, weights, intercept, new Float64Array(x.rows));
  return { r2: rSquared(y, yhat), ic: informationCoefficient(yhat, y) };
}

function main(): void {
  const configPath = process.argv[2] ?? 'configs/strategy.json';
  const config = loadStrategyConfig(readFileSync(configPath, 'utf8'));
  const csv = parseCsv(readFileSync(config.output.featuresPath, 'utf8'));

  const midIdx = columnIndex(csv.header, 'mid_ticks');
  const featureIdx = config.train.features.map((f) => columnIndex(csv.header, f));

  const steps = Math.round(config.train.horizonNs / config.train.gridIntervalNs);
  if (steps < 1) throw new ConfigError('train.horizonNs must be at least one train.gridIntervalNs');

  const usable = csv.rows.length - steps;
  const cols = featureIdx.length;
  if (usable < cols + 2) {
    throw new ConfigError(`not enough feature rows (${csv.rows.length}) to train ${cols} weights at horizon ${steps} steps`);
  }

  const data = new Float64Array(usable * cols);
  const y = new Float64Array(usable);
  for (let i = 0; i < usable; i++) {
    for (let c = 0; c < cols; c++) data[i * cols + c] = Number(csv.rows[i][featureIdx[c]]);
    y[i] = Number(csv.rows[i + steps][midIdx]) - Number(csv.rows[i][midIdx]);
  }

  const full: DesignMatrix = { rows: usable, cols, data };
  const split = splitRows(full, y, config.train.trainFraction);

  const prepared = config.train.standardizeFeatures
    ? standardize(split.trainX)
    : { design: split.trainX, standardization: identity(cols) };

  const fit = ridgeFit(prepared.design, split.trainY, config.train.ridgeLambda, true);
  const raw = toRawSpace(fit.beta, fit.intercept, prepared.standardization);

  const inSample = score(split.trainX, split.trainY, raw.weights, raw.intercept);
  const outOfSample = score(split.testX, split.testY, raw.weights, raw.intercept);

  const model: LinearModelArtifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'linear',
    inputs: config.train.features,
    outputs: ['mid_change_ticks'],
    lambda: fit.lambda,
    intercept: [raw.intercept],
    weights: Array.from(raw.weights),
  };

  ensureDir(config.train.modelPath);
  writeFileSync(config.train.modelPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');

  console.log(`rows                   : ${usable} (train ${split.trainX.rows}, test ${split.testX.rows})`);
  console.log(`horizon (grid steps)   : ${steps}`);
  console.log(`lambda                 : ${fit.lambda}`);
  console.log(`standardized           : ${config.train.standardizeFeatures}`);
  console.log(`condition estimate     : ${fit.conditionEstimate.toExponential(3)}`);
  for (let c = 0; c < cols; c++) console.log(`weight[${config.train.features[c]}] : ${raw.weights[c]}`);
  console.log(`intercept              : ${raw.intercept}`);
  console.log(`in-sample  R^2 / IC    : ${inSample.r2.toFixed(6)} / ${inSample.ic.toFixed(6)}`);
  console.log(`out-of-sample R^2 / IC : ${outOfSample.r2.toFixed(6)} / ${outOfSample.ic.toFixed(6)}`);
  if (!(outOfSample.ic > 0)) {
    console.log('warning: out-of-sample information coefficient is not positive; this model has found nothing');
  }
  console.log(`wrote                  : ${config.train.modelPath}`);
}

main();
