import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ConfigError,
  PromotionGateError,
  SCHEMA_VERSION,
  columnIndex,
  loadStrategyConfig,
  parseCsv,
  type LinearModelArtifact,
  type ModelProvenance,
} from '@hft/contracts';
import {
  DEFAULT_PROMOTION_THRESHOLDS,
  evaluatePromotionGate,
  informationCoefficient,
  informationCoefficientTStat,
  predict,
  purgedKFold,
  rSquared,
  ridgeFit,
  selectLambdaByCv,
  splitRows,
  standardize,
  toRawSpace,
  type DesignMatrix,
  type PromotionThresholds,
  type Standardization,
} from '@hft/numeric';

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

function contentHash(text: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash ^ BigInt(text.charCodeAt(i) & 0xff)) * FNV_PRIME) & FNV_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

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
  const configText = readFileSync(configPath, 'utf8');
  const config = loadStrategyConfig(configText);
  const featuresText = readFileSync(config.output.featuresPath, 'utf8');
  const csv = parseCsv(featuresText);

  const midIdx = columnIndex(csv.header, 'mid_ticks');
  const featureIdx = config.train.features.map((f) => columnIndex(csv.header, f));
  const costAdjusted = config.train.target === 'cost_adjusted';
  const spreadIdx = costAdjusted ? columnIndex(csv.header, 'spread_ticks') : -1;
  const takerFeeRate = config.sim.takerFeeBps / 10000;

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
    const midNow = Number(csv.rows[i][midIdx]);
    let target = Number(csv.rows[i + steps][midIdx]) - midNow;
    if (costAdjusted) target -= Number(csv.rows[i][spreadIdx]) / 2 + takerFeeRate * midNow;
    y[i] = target;
  }

  const full: DesignMatrix = { rows: usable, cols, data };
  const split = splitRows(full, y, config.train.trainFraction);

  const prepared = config.train.standardizeFeatures
    ? standardize(split.trainX)
    : { design: split.trainX, standardization: identity(cols) };

  let lambda = config.train.ridgeLambda;
  let lambdaSource = 'config';
  if (config.train.lambdaGrid !== undefined) {
    const embargo = config.train.embargoRows ?? steps;
    const folds = purgedKFold(split.trainX.rows, config.train.cvFolds ?? 5, embargo);
    const selection = selectLambdaByCv(
      split.trainX,
      split.trainY,
      config.train.lambdaGrid,
      folds,
      config.train.standardizeFeatures,
    );
    lambda = selection.best;
    lambdaSource = `purged ${config.train.cvFolds ?? 5}-fold CV (embargo ${embargo})`;
    for (const s of selection.scores) console.log(`cv lambda ${s.lambda} : mean R^2 ${s.meanR2.toFixed(6)}`);
  }

  const fit = ridgeFit(prepared.design, split.trainY, lambda, true);
  const raw = toRawSpace(fit.beta, fit.intercept, prepared.standardization);

  const inSample = score(split.trainX, split.trainY, raw.weights, raw.intercept);
  const outOfSample = score(split.testX, split.testY, raw.weights, raw.intercept);

  const target = costAdjusted ? 'cost_adjusted' : 'mid_change';
  const selectionTrials = config.train.lambdaGrid?.length ?? 1;
  const icTStat = informationCoefficientTStat(outOfSample.ic, split.testX.rows);
  const thresholds: PromotionThresholds = config.train.gate
    ? {
        minOutOfSampleIc: config.train.gate.minOutOfSampleIc,
        minIcTStat: config.train.gate.minIcTStat,
        requirePositiveR2: config.train.gate.requirePositiveR2 ?? false,
      }
    : DEFAULT_PROMOTION_THRESHOLDS;
  const gate = evaluatePromotionGate(
    { outOfSampleIc: outOfSample.ic, outOfSampleR2: outOfSample.r2, icTStat, selectionTrials },
    thresholds,
  );

  const provenance: ModelProvenance = {
    generatedAt: new Date().toISOString(),
    datasetHash: contentHash(featuresText),
    configHash: contentHash(configText),
    rows: usable,
    trainRows: split.trainX.rows,
    testRows: split.testX.rows,
    horizonSteps: steps,
    target,
    standardized: config.train.standardizeFeatures,
    lambda: fit.lambda,
    lambdaSource,
    conditionEstimate: fit.conditionEstimate,
    inSampleIc: inSample.ic,
    outOfSampleIc: outOfSample.ic,
    inSampleR2: inSample.r2,
    outOfSampleR2: outOfSample.r2,
    icTStat,
    deflatedIcTStat: gate.deflatedIcTStat,
    selectionTrials,
  };

  const model: LinearModelArtifact = {
    schemaVersion: SCHEMA_VERSION,
    kind: 'linear',
    inputs: config.train.features,
    outputs: [costAdjusted ? 'cost_adjusted_pnl_ticks' : 'mid_change_ticks'],
    lambda: fit.lambda,
    intercept: [raw.intercept],
    weights: Array.from(raw.weights),
    provenance,
  };

  console.log(`rows                   : ${usable} (train ${split.trainX.rows}, test ${split.testX.rows})`);
  console.log(`target                 : ${target}`);
  console.log(`horizon (grid steps)   : ${steps}`);
  console.log(`lambda                 : ${fit.lambda} (${lambdaSource})`);
  console.log(`standardized           : ${config.train.standardizeFeatures}`);
  console.log(`condition estimate     : ${fit.conditionEstimate.toExponential(3)}`);
  for (let c = 0; c < cols; c++) console.log(`weight[${config.train.features[c]}] : ${raw.weights[c]}`);
  console.log(`intercept              : ${raw.intercept}`);
  console.log(`in-sample  R^2 / IC    : ${inSample.r2.toFixed(6)} / ${inSample.ic.toFixed(6)}`);
  console.log(`out-of-sample R^2 / IC : ${outOfSample.r2.toFixed(6)} / ${outOfSample.ic.toFixed(6)}`);
  console.log(`oos IC t-stat / defl.  : ${icTStat.toFixed(4)} / ${gate.deflatedIcTStat.toFixed(4)} (${selectionTrials} trial(s))`);
  console.log(
    `gate                   : minIC ${thresholds.minOutOfSampleIc}, minT ${thresholds.minIcTStat}` +
      `${thresholds.requirePositiveR2 ? ', R^2>0' : ''}`,
  );

  if (!gate.passed) {
    for (const reason of gate.reasons) console.log(`gate reject            : ${reason}`);
    console.log(`not written            : ${config.train.modelPath}`);
    throw new PromotionGateError(gate.reasons);
  }

  ensureDir(config.train.modelPath);
  writeFileSync(config.train.modelPath, `${JSON.stringify(model, null, 2)}\n`, 'utf8');
  console.log(`gate                   : PASS`);
  console.log(`wrote                  : ${config.train.modelPath}`);
}

main();
