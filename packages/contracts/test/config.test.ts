import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  FILLS_SCHEMA,
  LIVE_FILLS_SCHEMA,
  SCHEMA_VERSION,
  fillRow,
  getTableSerializer,
  loadStrategyConfig,
  parseStrategyConfig,
  schemasEqual,
  toCsv,
} from '@hft/contracts';

function baseConfig(): Record<string, unknown> {
  const text = readFileSync(resolve(process.cwd(), 'configs/strategy.json'), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

describe('strategy config validation', () => {
  it('accepts the shipped example config', () => {
    const cfg = loadStrategyConfig(readFileSync(resolve(process.cwd(), 'configs/strategy.json'), 'utf8'));
    expect(cfg.schemaVersion).toBe(SCHEMA_VERSION);
    expect(cfg.strategy.kind).toBe('avellaneda_stoikov');
  });

  it('throws when a required field is missing', () => {
    const cfg = baseConfig();
    delete (cfg.instrument as Record<string, unknown>).tickSize;
    expect(() => parseStrategyConfig(cfg)).toThrowError(ConfigError);
    expect(() => parseStrategyConfig(cfg)).toThrowError(/missing required field "tickSize"/);
  });

  it('throws when an unknown field is present', () => {
    const cfg = baseConfig();
    (cfg.latency as Record<string, unknown>).networkJitterNs = 5;
    expect(() => parseStrategyConfig(cfg)).toThrowError(/unknown field "networkJitterNs"/);
  });

  it('throws on an unknown strategy variant instead of falling back to a default', () => {
    const cfg = baseConfig();
    (cfg.strategy as Record<string, unknown>).kind = 'deep_neural_alpha';
    expect(() => parseStrategyConfig(cfg)).toThrowError(/unknown variant "deep_neural_alpha"/);
  });

  it('throws on a wrong schema version', () => {
    const cfg = baseConfig();
    cfg.schemaVersion = 99;
    expect(() => parseStrategyConfig(cfg)).toThrowError(new RegExp(`expected ${SCHEMA_VERSION}, got 99`));
  });

  it('throws on a non-integer where an integer is required', () => {
    const cfg = baseConfig();
    (cfg.latency as Record<string, unknown>).marketDataNs = 1.5;
    expect(() => parseStrategyConfig(cfg)).toThrowError(/expected integer/);
  });

  it('throws when the strategy position limit exceeds the risk position limit', () => {
    const cfg = baseConfig();
    (cfg.strategy as Record<string, unknown>).maxPosition = 10_000;
    expect(() => parseStrategyConfig(cfg)).toThrowError(/must not exceed \$\.risk\.maxPosition/);
  });

  it('throws when the order size is not a multiple of the lot size', () => {
    const cfg = baseConfig();
    (cfg.instrument as Record<string, unknown>).lotSize = 3;
    (cfg.strategy as Record<string, unknown>).orderSize = 10;
    expect(() => parseStrategyConfig(cfg)).toThrowError(/must be a multiple of \$\.instrument\.lotSize/);
  });

  it('accepts an order size that is a multiple of the lot size', () => {
    const cfg = baseConfig();
    (cfg.instrument as Record<string, unknown>).lotSize = 5;
    (cfg.strategy as Record<string, unknown>).orderSize = 10;
    expect(parseStrategyConfig(cfg).strategy.orderSize).toBe(10);
  });

  it('accepts an optional lognormal latency model and rejects an unknown one', () => {
    const cfg = baseConfig();
    (cfg.latency as Record<string, unknown>).orderModel = { kind: 'lognormal', sigma: 0.5 };
    expect(parseStrategyConfig(cfg).latency.orderModel).toEqual({ kind: 'lognormal', sigma: 0.5 });

    (cfg.latency as Record<string, unknown>).orderModel = { kind: 'pareto', alpha: 2 };
    expect(() => parseStrategyConfig(cfg)).toThrowError(/unknown variant "pareto"/);
  });

  it('treats latency.orderModel as optional', () => {
    const cfg = baseConfig();
    delete (cfg.latency as Record<string, unknown>).orderModel;
    expect(parseStrategyConfig(cfg).latency.orderModel).toBeUndefined();
  });

  it('accepts an optional cost-adjusted train target and rejects unknown targets', () => {
    const cfg = baseConfig();
    (cfg.train as Record<string, unknown>).target = 'cost_adjusted';
    expect(parseStrategyConfig(cfg).train.target).toBe('cost_adjusted');
    (cfg.train as Record<string, unknown>).target = 'sharpe';
    expect(() => parseStrategyConfig(cfg)).toThrowError(/expected one of \[mid_change, cost_adjusted\]/);
  });

  it('accepts an optional cross-validation lambda grid', () => {
    const cfg = baseConfig();
    (cfg.train as Record<string, unknown>).lambdaGrid = [0.1, 1, 10];
    (cfg.train as Record<string, unknown>).cvFolds = 5;
    (cfg.train as Record<string, unknown>).embargoRows = 10;
    const parsed = parseStrategyConfig(cfg);
    expect(parsed.train.lambdaGrid).toEqual([0.1, 1, 10]);
    expect(parsed.train.cvFolds).toBe(5);
  });

  it('throws on invalid JSON', () => {
    expect(() => loadStrategyConfig('{ not json')).toThrowError(ConfigError);
  });
});

describe('fills and live_fills share one schema', () => {
  it('column names, types, order and version are identical', () => {
    expect(schemasEqual(FILLS_SCHEMA, LIVE_FILLS_SCHEMA)).toBe(true);
    expect(FILLS_SCHEMA.columns).toBe(LIVE_FILLS_SCHEMA.columns);
    expect(FILLS_SCHEMA.name).not.toBe(LIVE_FILLS_SCHEMA.name);
  });

  it('emit identical csv headers', () => {
    const a = toCsv(FILLS_SCHEMA, []);
    const b = toCsv(LIVE_FILLS_SCHEMA, []);
    expect(a).toBe(b);
  });

  it('rejects a row whose width does not match the schema', () => {
    expect(() => toCsv(FILLS_SCHEMA, [[1, 2]])).toThrowError(/row width/);
  });

  it('serialise one fill record to byte-identical rows under both schemas', () => {
    const fill = {
      timestampNs: 34200000000000,
      clientOrderId: 'as-0-1',
      side: 0 as const,
      priceTicks: 9998,
      size: 10,
      queuePositionAtFill: 40,
      midTicksAtFill: 9998.5,
      liquidity: 0 as const,
      depthAtFill: 250,
      spreadTicksAtFill: 1,
    };
    const sim = toCsv(FILLS_SCHEMA, [fillRow(fill)]);
    const live = toCsv(LIVE_FILLS_SCHEMA, [fillRow(fill)]);
    expect(live).toBe(sim);
    expect(sim.split('\n')[1]).toBe('34200000000000,as-0-1,0,9998,10,40,9998.5,0,250,1');
  });

  it('resolves the csv serializer named by output.format', () => {
    const serialize = getTableSerializer('csv');
    expect(serialize(FILLS_SCHEMA, [])).toBe(toCsv(FILLS_SCHEMA, []));
  });

  it('writes an empty cell rather than inventing a mid when the book was one-sided', () => {
    const fill = {
      timestampNs: 1,
      clientOrderId: 'a',
      side: 0 as const,
      priceTicks: 100,
      size: 1,
      queuePositionAtFill: 0,
      midTicksAtFill: NaN,
      liquidity: 0 as const,
      depthAtFill: 5,
      spreadTicksAtFill: NaN,
    };
    expect(toCsv(FILLS_SCHEMA, [fillRow(fill)]).split('\n')[1]).toBe('1,a,0,100,1,0,,0,5,');
  });
});
