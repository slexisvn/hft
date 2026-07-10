import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  FILLS_SCHEMA,
  LIVE_FILLS_SCHEMA,
  SCHEMA_VERSION,
  fillRow,
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
    expect(() => parseStrategyConfig(cfg)).toThrowError(/expected 1, got 99/);
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
    };
    const sim = toCsv(FILLS_SCHEMA, [fillRow(fill)]);
    const live = toCsv(LIVE_FILLS_SCHEMA, [fillRow(fill)]);
    expect(live).toBe(sim);
    expect(sim.split('\n')[1]).toBe('34200000000000,as-0-1,0,9998,10,40,9998.5,0');
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
    };
    expect(toCsv(FILLS_SCHEMA, [fillRow(fill)]).split('\n')[1]).toBe('1,a,0,100,1,0,,0');
  });
});
