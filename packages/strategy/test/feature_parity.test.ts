import { describe, expect, it } from 'vitest';
import {
  FEATURE_SPECS,
  PREDICTOR_FEATURE_NAMES,
  PREDICTOR_FIELDS,
  assembleFeatureRecord,
  featureRow,
  FEATURES_SCHEMA,
  type FeatureRecord,
} from '@hft/contracts';
import {
  MultiLevelOfi,
  WindowedOfi,
  createFeaturePipeline,
  depthImbalance,
  featureExtractors,
  type MarketSnapshot,
} from '@hft/metrics';
import { assertKnownFeatures } from '@hft/strategy';

const WINDOW = 1_000_000_000;
const DEPTH = 2;

function snapshot(ts: number, bid: number, bidSz: number, ask: number, askSz: number): MarketSnapshot {
  const bidLvT = [bid, bid - 1];
  const bidLvS = [bidSz, bidSz + 1];
  const askLvT = [ask, ask + 1];
  const askLvS = [askSz, askSz + 2];
  return {
    timestampNs: ts,
    bidTicks: bid,
    bidSize: bidSz,
    askTicks: ask,
    askSize: askSz,
    depthLevels: DEPTH,
    bidDepthCount: DEPTH,
    askDepthCount: DEPTH,
    bidLevelTicks: (m) => bidLvT[m],
    bidLevelSize: (m) => bidLvS[m],
    askLevelTicks: (m) => askLvT[m],
    askLevelSize: (m) => askLvS[m],
  };
}

describe('feature single source of truth', () => {
  it('predictor names match schema predictor columns and every name has one extractor', () => {
    const predictorColumns = FEATURE_SPECS.filter((s) => s.role === 'predictor').map((s) => s.name);
    expect([...PREDICTOR_FEATURE_NAMES]).toEqual(predictorColumns);

    const extractorKeys = Object.keys(featureExtractors).sort();
    expect(extractorKeys).toEqual([...PREDICTOR_FEATURE_NAMES].sort());

    const schemaNames = FEATURES_SCHEMA.columns.map((c) => c.name);
    for (const name of PREDICTOR_FEATURE_NAMES) expect(schemaNames).toContain(name);
  });

  it('assertKnownFeatures accepts every predictor name and rejects unknown ones', () => {
    expect(assertKnownFeatures(PREDICTOR_FEATURE_NAMES)).toEqual([...PREDICTOR_FEATURE_NAMES]);
    expect(() => assertKnownFeatures(['micro_price_offset'])).toThrow();
    expect(() => assertKnownFeatures(['not_a_feature'])).toThrow();
  });

  it('assembleFeatureRecord and featureRow round-trip through FEATURE_SPECS order', () => {
    const values = Float64Array.from(PREDICTOR_FIELDS.map((_, i) => i + 1));
    const rec = assembleFeatureRecord(42, 100, values);
    expect(rec.timestampNs).toBe(42);
    expect(rec.midTicks).toBe(100);
    for (let i = 0; i < PREDICTOR_FIELDS.length; i++) {
      expect(rec[PREDICTOR_FIELDS[i]]).toBe(values[i]);
    }
    const row = featureRow(rec);
    const expected = FEATURE_SPECS.map((s) => (rec as unknown as Record<string, number>)[s.field]);
    expect([...row]).toEqual(expected);
  });
});

describe('feature registry math is exact and matches its underlying accumulators', () => {
  it('book features equal their closed-form definitions', () => {
    const pipeline = createFeaturePipeline(PREDICTOR_FEATURE_NAMES, { ofiWindowNs: WINDOW, depthLevels: DEPTH });
    const out = new Float64Array(PREDICTOR_FEATURE_NAMES.length);

    pipeline.update(snapshot(1000, 100, 30, 101, 10));
    pipeline.read(out, 1000);
    const idx = (name: string): number => PREDICTOR_FEATURE_NAMES.indexOf(name as never);

    const total = 30 + 10;
    expect(out[idx('micro_price_ticks')]).toBeCloseTo((100 * 10 + 101 * 30) / total, 12);
    expect(out[idx('spread_ticks')]).toBe(1);
    expect(out[idx('bid_size')]).toBe(30);
    expect(out[idx('ask_size')]).toBe(10);
    expect(out[idx('depth_imbalance')]).toBeCloseTo(depthImbalance(30, 10), 12);
  });

  it('trade_sign persists the last trade and ofi/multi_level_ofi track their accumulators', () => {
    const names = PREDICTOR_FEATURE_NAMES;
    const pipeline = createFeaturePipeline(names, { ofiWindowNs: WINDOW, depthLevels: DEPTH });
    const out = new Float64Array(names.length);
    const idx = (name: string): number => names.indexOf(name as never);

    const refOfi = new WindowedOfi(WINDOW);
    const refMulti = new MultiLevelOfi(DEPTH, WINDOW);
    const bidLvT = new Float64Array(DEPTH);
    const bidLvS = new Float64Array(DEPTH);
    const askLvT = new Float64Array(DEPTH);
    const askLvS = new Float64Array(DEPTH);

    const steps: [number, number, number, number, number][] = [
      [1000, 100, 30, 101, 10],
      [2000, 100, 40, 101, 10],
      [3000, 101, 20, 102, 15],
    ];

    let step = 0;
    for (const [ts, bid, bidSz, ask, askSz] of steps) {
      const snap = snapshot(ts, bid, bidSz, ask, askSz);
      pipeline.update(snap);
      refOfi.update(ts, bid, bidSz, ask, askSz);
      for (let m = 0; m < DEPTH; m++) {
        bidLvT[m] = snap.bidLevelTicks(m);
        bidLvS[m] = snap.bidLevelSize(m);
        askLvT[m] = snap.askLevelTicks(m);
        askLvS[m] = snap.askLevelSize(m);
      }
      refMulti.update(ts, bidLvT, bidLvS, askLvT, askLvS, DEPTH, 0);
      if (step === 1) pipeline.onTrade(1);
      pipeline.read(out, ts);
      expect(out[idx('ofi')]).toBeCloseTo(refOfi.valueAsOf(ts), 12);
      expect(out[idx('multi_level_ofi')]).toBeCloseTo(refMulti.valueAsOf(ts), 12);
      expect(out[idx('trade_sign')]).toBe(step >= 1 ? 1 : 0);
      step++;
    }
  });
});

describe('offline assembly maps registry output onto the correct named fields', () => {
  it('a held book state produces a record whose fields equal the pipeline vector', () => {
    const snap = snapshot(5000, 100, 25, 101, 12);
    const pipeline = createFeaturePipeline(PREDICTOR_FEATURE_NAMES, { ofiWindowNs: WINDOW, depthLevels: DEPTH });
    const values = new Float64Array(PREDICTOR_FEATURE_NAMES.length);
    pipeline.update(snap);
    pipeline.read(values, snap.timestampNs);

    const rec: FeatureRecord = assembleFeatureRecord(snap.timestampNs, (snap.bidTicks + snap.askTicks) / 2, values);
    for (let i = 0; i < PREDICTOR_FEATURE_NAMES.length; i++) {
      const field = PREDICTOR_FIELDS[i];
      expect((rec as unknown as Record<string, number>)[field]).toBe(values[i]);
    }
  });
});
