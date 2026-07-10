import { ConfigError } from './errors';
import { SCHEMA_VERSION } from './schema';
import { validate, type Spec } from './validate';

export interface InstrumentConfig {
  readonly symbol: string;
  readonly tickSize: number;
  readonly lotSize: number;
  readonly priceScale: number;
  readonly minPriceTicks: number;
  readonly maxPriceTicks: number;
}

export interface LatencyConfig {
  readonly marketDataNs: number;
  readonly decisionNs: number;
  readonly orderEntryNs: number;
}

export interface SimConfig {
  readonly seed: number;
  readonly makerFeeBps: number;
  readonly takerFeeBps: number;
  readonly initialOrderCapacity: number;
}

export interface MetricsConfig {
  readonly markoutHorizonsNs: readonly number[];
  readonly realizedSpreadHorizonNs: number;
  readonly ofiWindowNs: number;
  readonly inventorySampleIntervalNs: number;
}

export interface BookConfig {
  readonly snapshotDepth: number;
}

export interface AvellanedaParams {
  readonly kind: 'avellaneda_stoikov';
  readonly gamma: number;
  readonly sigmaTicksPerSqrtSecond: number;
  readonly kappa: number;
  readonly sessionStartNs: number;
  readonly sessionEndNs: number;
  readonly orderSize: number;
  readonly maxHalfSpreadTicks: number;
  readonly requoteThresholdTicks: number;
  readonly maxPosition: number;
}

export interface LinearParams {
  readonly kind: 'linear';
  readonly modelPath: string;
  readonly features: readonly string[];
  readonly entryThreshold: number;
  readonly orderSize: number;
  readonly skewTicksPerUnit: number;
  readonly baseHalfSpreadTicks: number;
  readonly requoteThresholdTicks: number;
  readonly maxPosition: number;
}

export type StrategyParams = AvellanedaParams | LinearParams;

export interface RiskConfig {
  readonly maxPosition: number;
  readonly maxLossTicks: number;
  readonly maxOrdersPerSecond: number;
  readonly reconcileToleranceQty: number;
}

export interface RateLimitConfig {
  readonly capacityTokens: number;
  readonly refillTokensPerSecond: number;
}

export interface LiveConfig {
  readonly restEndpoint: string;
  readonly wsEndpoint: string;
  readonly rateLimit: RateLimitConfig;
  readonly reconcileIntervalNs: number;
  readonly resyncOnSequenceGap: boolean;
}

export interface TrainConfig {
  readonly ridgeLambda: number;
  readonly horizonNs: number;
  readonly gridIntervalNs: number;
  readonly trainFraction: number;
  readonly standardizeFeatures: boolean;
  readonly features: readonly string[];
  readonly modelPath: string;
}

export interface OutputConfig {
  readonly format: 'csv';
  readonly featuresPath: string;
  readonly fillsPath: string;
  readonly metricsPath: string;
  readonly liveFillsPath: string;
}

export interface InputConfig {
  readonly messagePath: string;
}

export interface SweepConfig {
  readonly gammaGrid: readonly number[];
  readonly kappaGrid: readonly number[];
}

export interface StrategyConfig {
  readonly schemaVersion: number;
  readonly name: string;
  readonly input: InputConfig;
  readonly sweep: SweepConfig;
  readonly instrument: InstrumentConfig;
  readonly latency: LatencyConfig;
  readonly sim: SimConfig;
  readonly book: BookConfig;
  readonly metrics: MetricsConfig;
  readonly strategy: StrategyParams;
  readonly risk: RiskConfig;
  readonly live: LiveConfig;
  readonly train: TrainConfig;
  readonly output: OutputConfig;
}

const nonNegInt: Spec = { kind: 'number', int: true, min: 0 };
const posInt: Spec = { kind: 'number', int: true, exclusiveMin: 0 };
const posNum: Spec = { kind: 'number', exclusiveMin: 0 };
const anyNum: Spec = { kind: 'number' };
const nonNegNum: Spec = { kind: 'number', min: 0 };
const str: Spec = { kind: 'string', minLength: 1 };

const AVELLANEDA_SPEC: Spec = {
  kind: 'object',
  fields: {
    kind: { kind: 'string', values: ['avellaneda_stoikov'] },
    gamma: posNum,
    sigmaTicksPerSqrtSecond: posNum,
    kappa: posNum,
    sessionStartNs: nonNegInt,
    sessionEndNs: posInt,
    orderSize: posInt,
    maxHalfSpreadTicks: posNum,
    requoteThresholdTicks: nonNegNum,
    maxPosition: posInt,
  },
};

const LINEAR_SPEC: Spec = {
  kind: 'object',
  fields: {
    kind: { kind: 'string', values: ['linear'] },
    modelPath: str,
    features: { kind: 'array', item: str, minLength: 1 },
    entryThreshold: nonNegNum,
    orderSize: posInt,
    skewTicksPerUnit: anyNum,
    baseHalfSpreadTicks: posNum,
    requoteThresholdTicks: nonNegNum,
    maxPosition: posInt,
  },
};

export const STRATEGY_CONFIG_SPEC: Spec = {
  kind: 'object',
  fields: {
    schemaVersion: posInt,
    name: str,
    input: { kind: 'object', fields: { messagePath: str } },
    sweep: {
      kind: 'object',
      fields: {
        gammaGrid: { kind: 'array', item: posNum, minLength: 1 },
        kappaGrid: { kind: 'array', item: posNum, minLength: 1 },
      },
    },
    instrument: {
      kind: 'object',
      fields: {
        symbol: str,
        tickSize: posNum,
        lotSize: posInt,
        priceScale: posInt,
        minPriceTicks: nonNegInt,
        maxPriceTicks: posInt,
      },
    },
    latency: {
      kind: 'object',
      fields: { marketDataNs: nonNegInt, decisionNs: nonNegInt, orderEntryNs: nonNegInt },
    },
    sim: {
      kind: 'object',
      fields: { seed: nonNegInt, makerFeeBps: anyNum, takerFeeBps: anyNum, initialOrderCapacity: posInt },
    },
    book: { kind: 'object', fields: { snapshotDepth: posInt } },
    metrics: {
      kind: 'object',
      fields: {
        markoutHorizonsNs: { kind: 'array', item: posInt, minLength: 1 },
        realizedSpreadHorizonNs: posInt,
        ofiWindowNs: posInt,
        inventorySampleIntervalNs: posInt,
      },
    },
    strategy: {
      kind: 'tagged',
      tag: 'kind',
      variants: { avellaneda_stoikov: AVELLANEDA_SPEC, linear: LINEAR_SPEC },
    },
    risk: {
      kind: 'object',
      fields: {
        maxPosition: posInt,
        maxLossTicks: posNum,
        maxOrdersPerSecond: posNum,
        reconcileToleranceQty: nonNegNum,
      },
    },
    live: {
      kind: 'object',
      fields: {
        restEndpoint: str,
        wsEndpoint: str,
        rateLimit: { kind: 'object', fields: { capacityTokens: posNum, refillTokensPerSecond: posNum } },
        reconcileIntervalNs: posInt,
        resyncOnSequenceGap: { kind: 'boolean' },
      },
    },
    train: {
      kind: 'object',
      fields: {
        ridgeLambda: nonNegNum,
        horizonNs: posInt,
        gridIntervalNs: posInt,
        trainFraction: { kind: 'number', exclusiveMin: 0, max: 0.99 },
        standardizeFeatures: { kind: 'boolean' },
        features: { kind: 'array', item: str, minLength: 1 },
        modelPath: str,
      },
    },
    output: {
      kind: 'object',
      fields: {
        format: { kind: 'string', values: ['csv'] },
        featuresPath: str,
        fillsPath: str,
        metricsPath: str,
        liveFillsPath: str,
      },
    },
  },
};

export function parseStrategyConfig(raw: unknown): StrategyConfig {
  const cfg = validate(STRATEGY_CONFIG_SPEC, raw) as StrategyConfig;
  if (cfg.schemaVersion !== SCHEMA_VERSION) {
    throw new ConfigError(`$.schemaVersion: expected ${SCHEMA_VERSION}, got ${cfg.schemaVersion}`);
  }
  if (cfg.instrument.maxPriceTicks <= cfg.instrument.minPriceTicks) {
    throw new ConfigError('$.instrument: maxPriceTicks must exceed minPriceTicks');
  }
  if (cfg.strategy.kind === 'avellaneda_stoikov' && cfg.strategy.sessionEndNs <= cfg.strategy.sessionStartNs) {
    throw new ConfigError('$.strategy: sessionEndNs must exceed sessionStartNs');
  }
  if (cfg.strategy.maxPosition > cfg.risk.maxPosition) {
    throw new ConfigError(
      `$.strategy.maxPosition (${cfg.strategy.maxPosition}) must not exceed $.risk.maxPosition (${cfg.risk.maxPosition})`,
    );
  }
  return cfg;
}

export function loadStrategyConfig(text: string): StrategyConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`invalid JSON: ${(err as Error).message}`);
  }
  return parseStrategyConfig(raw);
}

export const LINEAR_MODEL_SPEC: Spec = {
  kind: 'object',
  fields: {
    schemaVersion: posInt,
    kind: { kind: 'string', values: ['linear'] },
    inputs: { kind: 'array', item: str, minLength: 1 },
    outputs: { kind: 'array', item: str, minLength: 1 },
    lambda: nonNegNum,
    intercept: { kind: 'array', item: anyNum, minLength: 1 },
    weights: { kind: 'array', item: anyNum, minLength: 1 },
  },
};
