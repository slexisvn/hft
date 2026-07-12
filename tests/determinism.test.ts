import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FILLS_SCHEMA, fillRow, toCsv, type AvellanedaParams } from '@hft/contracts';
import { SimEngine, lognormalLatency } from '@hft/sim';
import { Rng } from '@hft/numeric';
import { AvellanedaStoikovStrategy } from '@hft/strategy';
import { buildEvents } from './helpers';

const PARAMS: AvellanedaParams = {
  kind: 'avellaneda_stoikov',
  gamma: 0.1,
  sigmaTicksPerSqrtSecond: 0.5,
  kappa: 1.5,
  sessionStartNs: 0,
  sessionEndNs: 1_000_000_000,
  orderSize: 10,
  maxHalfSpreadTicks: 5,
  requoteThresholdTicks: 1,
  maxPosition: 200,
};

const SEED = 20260710;

function runOnce(stochasticLatency = false): string {
  const engine = new SimEngine(
    {
      minPriceTicks: 900,
      maxPriceTicks: 1100,
      initialOrderCapacity: 64,
      snapshotDepth: 5,
      marketDataLatencyNs: 500_000,
      decisionLatencyNs: 100_000,
      orderEntryLatencyNs: 900_000,
      makerFeeBps: -1,
      takerFeeBps: 5,
      inventorySampleIntervalNs: 1000000,
      orderLatencyNs: stochasticLatency ? lognormalLatency(1_000_000, 0.6, new Rng(SEED)) : undefined,
    },
    new AvellanedaStoikovStrategy(PARAMS),
  );
  const result = engine.run(buildEvents());
  return toCsv(FILLS_SCHEMA, result.fills.map(fillRow));
}

describe('determinism', () => {
  it('the same config and the same data produce byte-identical fills', () => {
    const a = runOnce();
    const b = runOnce();
    expect(b).toBe(a);
  });

  it('stays byte-identical under a seeded stochastic latency model', () => {
    const a = runOnce(true);
    const b = runOnce(true);
    expect(b).toBe(a);
  });

  it('no source file calls Math.random', () => {
    const offenders: string[] = [];
    for (const file of walk(resolve(process.cwd(), 'packages'), []).concat(
      walk(resolve(process.cwd(), 'apps'), []),
      walk(resolve(process.cwd(), 'bench'), []),
    )) {
      if (readFileSync(file, 'utf8').indexOf('Math.random') >= 0) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}
