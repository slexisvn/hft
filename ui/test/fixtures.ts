import { FILLS_SCHEMA, SIDE_ASK, SIDE_BID, type LinearModelArtifact, type MetricsJson } from '@hft/contracts';
import type { ReportData } from '../src/lib/loaders';
import type { TableRow } from '../src/lib/table';

export const fixtureMetrics: MetricsJson = {
  schemaVersion: 3,
  strategy: 'linear',
  markout: [
    { horizonNs: 100_000_000, meanTicks: 1.25, meanBps: 1.25, count: 40 },
    { horizonNs: 1_000_000_000, meanTicks: -2.5, meanBps: -2.5, count: 40 },
  ],
  markoutVsFillPrice: [],
  markoutBid: [],
  markoutAsk: [],
  effectiveSpreadTicksMean: 1.5,
  realizedSpreadTicksMean: -0.5,
  priceImprovementTicksMean: 0,
  fillRatio: 0.25,
  fillCount: 12,
  submissionCount: 48,
  inventoryMean: 3.2,
  inventoryTimeWeightedMean: 3.1,
  inventoryMin: -4,
  inventoryMax: 9,
  inventoryEnd: 7,
  pnlTicks: 1234.5,
  sharpePerStep: 0.4211,
  sortinoPerStep: 0.6789,
  maxDrawdownTicks: 312.75,
  orderDepthRatioP95: 0.12,
  orderDepthRatioMax: 0.18,
  selfImpactWarning: false,
};

export const fixtureModel: LinearModelArtifact = {
  schemaVersion: 3,
  kind: 'linear',
  inputs: ['micro_price_ticks', 'ofi', 'spread_ticks'],
  outputs: ['mid_change_ticks'],
  lambda: 1,
  intercept: [3006.19],
  weights: [-0.3031, 0.0003, 0.5357],
  provenance: {
    generatedAt: '2026-07-13T14:17:04.374Z',
    datasetHash: 'a6db042ffd601b3c',
    configHash: '66b3864ec0bb166e',
    rows: 230,
    trainRows: 161,
    testRows: 69,
    horizonSteps: 10,
    target: 'mid_change',
    standardized: true,
    lambda: 1,
    lambdaSource: 'config',
    conditionEstimate: 15.02,
    inSampleIc: 0.6046,
    outOfSampleIc: 0.7573,
    inSampleR2: 0.3656,
    outOfSampleR2: 0.2425,
    icTStat: 9.4924,
    deflatedIcTStat: 9.4924,
    selectionTrials: 1,
  },
};

function fill(timestampNs: number, side: number, priceTicks: number, size: number, midTicks: number): TableRow {
  return {
    timestamp_ns: timestampNs,
    client_order_id: `fx-${timestampNs}`,
    side,
    price_ticks: priceTicks,
    size,
    queue_position_at_fill: 0,
    mid_ticks_at_fill: midTicks,
    liquidity: 0,
    depth_at_fill: 100,
    spread_ticks_at_fill: 1,
  };
}

export const fixtureFills: readonly TableRow[] = [
  fill(1, SIDE_BID, 9999, 10, 9999.5),
  fill(2, SIDE_ASK, 10002, 5, 10001.5),
  fill(3, SIDE_ASK, 10003, 5, 10002.5),
];

export const fixtureReport: ReportData = {
  metrics: fixtureMetrics,
  model: fixtureModel,
  fills: fixtureFills,
  fillsSchema: FILLS_SCHEMA,
};
