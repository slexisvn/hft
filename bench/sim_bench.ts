import { performance } from 'node:perf_hooks';
import {
  EV_EXECUTE_VISIBLE,
  EV_NEW_LIMIT_ORDER,
  EV_TOTAL_DELETE,
  SIDE_ASK,
  SIDE_BID,
  type AvellanedaParams,
  type Side,
} from '@hft/contracts';
import { EventBuffer } from '@hft/events';
import { SimEngine } from '@hft/sim';
import { AvellanedaStoikovStrategy } from '@hft/strategy';

const EVENT_COUNT = Number(process.env.HFT_SIM_BENCH_EVENTS ?? '500000');
const REGRESSION_FLOOR_PER_SEC = Number(process.env.HFT_BENCH_FLOOR_SIM ?? '0');
const MID = 100000;
const MIN_TICKS = 90000;
const MAX_TICKS = 110000;

function xorshift32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function buildEvents(n: number): EventBuffer {
  const b = new EventBuffer(n);
  const rnd = xorshift32(20260710);
  const live: { id: number; side: Side; px: number; sz: number }[] = [];
  let nextId = 1;
  for (let i = 0; i < n; i++) {
    const ts = i * 1000;
    if (live.length < 32 || rnd() < 0.6) {
      const side: Side = rnd() < 0.5 ? SIDE_BID : SIDE_ASK;
      const offset = 1 + Math.floor(rnd() * 15);
      const px = side === SIDE_BID ? MID - offset : MID + offset;
      const sz = 1 + Math.floor(rnd() * 200);
      b.push(ts, EV_NEW_LIMIT_ORDER, side, nextId, sz, px);
      live.push({ id: nextId, side, px, sz });
      nextId++;
    } else {
      const k = Math.floor(rnd() * live.length);
      const o = live[k];
      b.push(ts, rnd() < 0.5 ? EV_EXECUTE_VISIBLE : EV_TOTAL_DELETE, o.side, o.id, o.sz, o.px);
      live.splice(k, 1);
    }
  }
  return b;
}

const PARAMS: AvellanedaParams = {
  kind: 'avellaneda_stoikov',
  gamma: 0.05,
  sigmaTicksPerSqrtSecond: 0.2,
  kappa: 3,
  sessionStartNs: 0,
  sessionEndNs: EVENT_COUNT * 1000 + 1,
  orderSize: 10,
  maxHalfSpreadTicks: 20,
  requoteThresholdTicks: 1,
  maxPosition: 200,
};

function run(): void {
  const events = buildEvents(EVENT_COUNT);
  const opts = {
    minPriceTicks: MIN_TICKS,
    maxPriceTicks: MAX_TICKS,
    initialOrderCapacity: 1 << 16,
    snapshotDepth: 10,
    marketDataLatencyNs: 500_000,
    decisionLatencyNs: 100_000,
    orderEntryLatencyNs: 900_000,
    makerFeeBps: -1,
    takerFeeBps: 5,
    inventorySampleIntervalNs: 100_000_000,
  };

  new SimEngine(opts, new AvellanedaStoikovStrategy(PARAMS)).run(buildEvents(50_000));

  const start = performance.now();
  const result = new SimEngine(opts, new AvellanedaStoikovStrategy(PARAMS)).run(events);
  const elapsedMs = performance.now() - start;
  const perSec = (EVENT_COUNT / elapsedMs) * 1000;

  console.log(`sim events             : ${EVENT_COUNT}`);
  console.log(`sim elapsed (ms)       : ${elapsedMs.toFixed(2)}`);
  console.log(`sim throughput (ev/s)  : ${perSec.toFixed(0)}`);
  console.log(`sim ns per event       : ${((elapsedMs * 1e6) / EVENT_COUNT).toFixed(1)}`);
  console.log(`sim fills              : ${result.fills.length}`);
  console.log(`sim submissions        : ${result.submissionCount}`);

  if (REGRESSION_FLOOR_PER_SEC > 0 && perSec < REGRESSION_FLOOR_PER_SEC) {
    console.error(`REGRESSION (sim): ${perSec.toFixed(0)} events/s below floor ${REGRESSION_FLOOR_PER_SEC}`);
    process.exitCode = 1;
  }
}

run();
