import { performance } from 'node:perf_hooks';
import {
  EV_EXECUTE_VISIBLE,
  EV_NEW_LIMIT_ORDER,
  EV_PARTIAL_CANCEL,
  EV_TOTAL_DELETE,
  NO_PRICE,
  SIDE_ASK,
  SIDE_BID,
  type EventType,
  type Side,
} from '@hft/contracts';
import { L2Book, L3Book } from '@hft/book';

const EVENT_COUNT = Number(process.env.HFT_BENCH_EVENTS ?? '2000000');
const MIN_TICKS = 90000;
const MAX_TICKS = 110000;
const REGRESSION_FLOOR_EVENTS_PER_SEC = Number(process.env.HFT_BENCH_FLOOR ?? '0');
const REGRESSION_FLOOR_L2_PER_SEC = Number(process.env.HFT_BENCH_FLOOR_L2 ?? '0');

function xorshift32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

interface Gen {
  ts: Float64Array;
  type: Uint8Array;
  side: Uint8Array;
  id: Int32Array;
  px: Int32Array;
  sz: Int32Array;
}

function generate(n: number): Gen {
  const rnd = xorshift32(20260710);
  const ts = new Float64Array(n);
  const type = new Uint8Array(n);
  const side = new Uint8Array(n);
  const id = new Int32Array(n);
  const px = new Int32Array(n);
  const sz = new Int32Array(n);

  const liveIds: number[] = [];
  const liveSide: number[] = [];
  const livePx: number[] = [];
  const liveSz: number[] = [];
  let nextId = 1;
  const mid = 100000;

  for (let i = 0; i < n; i++) {
    ts[i] = i * 1000;
    const r = rnd();
    if (liveIds.length < 64 || r < 0.55) {
      const s: Side = rnd() < 0.5 ? SIDE_BID : SIDE_ASK;
      const offset = 1 + Math.floor(rnd() * 20);
      const price = s === SIDE_BID ? mid - offset : mid + offset;
      const size = 1 + Math.floor(rnd() * 500);
      type[i] = EV_NEW_LIMIT_ORDER;
      side[i] = s;
      id[i] = nextId;
      px[i] = price;
      sz[i] = size;
      liveIds.push(nextId);
      liveSide.push(s);
      livePx.push(price);
      liveSz.push(size);
      nextId++;
    } else {
      const k = Math.floor(rnd() * liveIds.length);
      const pick = rnd();
      side[i] = liveSide[k];
      id[i] = liveIds[k];
      px[i] = livePx[k];
      if (pick < 0.3 && liveSz[k] > 1) {
        type[i] = EV_PARTIAL_CANCEL;
        const delta = 1 + Math.floor(rnd() * (liveSz[k] - 1));
        sz[i] = delta;
        liveSz[k] -= delta;
      } else if (pick < 0.7) {
        type[i] = EV_TOTAL_DELETE;
        sz[i] = liveSz[k];
        liveIds.splice(k, 1);
        liveSide.splice(k, 1);
        livePx.splice(k, 1);
        liveSz.splice(k, 1);
      } else {
        type[i] = EV_EXECUTE_VISIBLE;
        sz[i] = liveSz[k];
        liveIds.splice(k, 1);
        liveSide.splice(k, 1);
        livePx.splice(k, 1);
        liveSz.splice(k, 1);
      }
    }
  }
  return { ts, type, side, id, px, sz };
}

function run(): void {
  const g = generate(EVENT_COUNT);
  const book = new L3Book({ minPriceTicks: MIN_TICKS, maxPriceTicks: MAX_TICKS, initialOrderCapacity: 1 << 16 });

  for (let i = 0; i < 50000; i++) {
    book.apply(g.ts[i], g.type[i] as EventType, g.id[i], g.side[i] as Side, g.px[i], g.sz[i]);
  }
  book.reset();

  const start = performance.now();
  for (let i = 0; i < EVENT_COUNT; i++) {
    book.apply(g.ts[i], g.type[i] as EventType, g.id[i], g.side[i] as Side, g.px[i], g.sz[i]);
  }
  const elapsedMs = performance.now() - start;
  const perSec = (EVENT_COUNT / elapsedMs) * 1000;

  console.log(`events                 : ${EVENT_COUNT}`);
  console.log(`elapsed (ms)           : ${elapsedMs.toFixed(2)}`);
  console.log(`throughput (events/s)  : ${perSec.toFixed(0)}`);
  console.log(`ns per event           : ${((elapsedMs * 1e6) / EVENT_COUNT).toFixed(1)}`);
  console.log(`best bid / ask         : ${book.bestBidTicks()} / ${book.bestAskTicks()}`);
  console.log(`live orders            : ${book.liveOrderCount}`);
  console.log(`unknown order events   : ${book.unknownOrderEventCount}`);

  if (REGRESSION_FLOOR_EVENTS_PER_SEC > 0 && perSec < REGRESSION_FLOOR_EVENTS_PER_SEC) {
    console.error(`REGRESSION: ${perSec.toFixed(0)} events/s below floor ${REGRESSION_FLOOR_EVENTS_PER_SEC}`);
    process.exitCode = 1;
  }
  if (book.bestBidTicks() === NO_PRICE) console.log('note: book ended with an empty bid side');
}

function runL2(): void {
  const g = generate(EVENT_COUNT);
  const book = new L2Book({ minPriceTicks: MIN_TICKS, maxPriceTicks: MAX_TICKS });
  const running = new Int32Array((MAX_TICKS - MIN_TICKS + 1) * 2);

  const applyOne = (i: number): void => {
    const side = g.side[i] as Side;
    const li = side * (MAX_TICKS - MIN_TICKS + 1) + (g.px[i] - MIN_TICKS);
    const delta = g.type[i] === EV_NEW_LIMIT_ORDER ? g.sz[i] : -g.sz[i];
    const next = running[li] + delta;
    running[li] = next < 0 ? 0 : next;
    book.setLevel(g.ts[i], side, g.px[i], running[li]);
  };

  for (let i = 0; i < 50000; i++) applyOne(i);
  book.reset();
  running.fill(0);

  const start = performance.now();
  for (let i = 0; i < EVENT_COUNT; i++) applyOne(i);
  const elapsedMs = performance.now() - start;
  const perSec = (EVENT_COUNT / elapsedMs) * 1000;

  console.log('---');
  console.log(`L2 setLevel ops        : ${EVENT_COUNT}`);
  console.log(`L2 throughput (ops/s)  : ${perSec.toFixed(0)}`);
  console.log(`L2 ns per op           : ${((elapsedMs * 1e6) / EVENT_COUNT).toFixed(1)}`);
  console.log(`L2 best bid / ask      : ${book.bestBidTicks()} / ${book.bestAskTicks()}`);

  if (REGRESSION_FLOOR_L2_PER_SEC > 0 && perSec < REGRESSION_FLOOR_L2_PER_SEC) {
    console.error(`REGRESSION (L2): ${perSec.toFixed(0)} ops/s below floor ${REGRESSION_FLOOR_L2_PER_SEC}`);
    process.exitCode = 1;
  }
}

function runL2Repair(): void {
  const wideMin = 0;
  const wideMax = 2_000_000;
  const book = new L2Book({ minPriceTicks: wideMin, maxPriceTicks: wideMax });
  const asks = [1_000_000, 1_500_000, 1_999_999];
  const bids = [999_999, 500_000, 1];
  for (const p of asks) book.setLevel(0, SIDE_ASK, p, 100);
  for (const p of bids) book.setLevel(0, SIDE_BID, p, 100);

  const iters = 2_000_000;
  const start = performance.now();
  for (let i = 0; i < iters; i++) {
    const best = book.bestAskTicks();
    book.setLevel(i, SIDE_ASK, best, 0);
    book.setLevel(i, SIDE_ASK, best, 100);
  }
  const elapsedMs = performance.now() - start;
  const perSec = (iters / elapsedMs) * 1000;

  console.log('---');
  console.log(`L2 repairBest window   : [${wideMin}, ${wideMax}] (sparse, worst case for a linear scan)`);
  console.log(`L2 repairBest ops      : ${iters}`);
  console.log(`L2 repairBest ops/s    : ${perSec.toFixed(0)}`);
  console.log(`L2 repairBest ns per op: ${((elapsedMs * 1e6) / iters).toFixed(1)}`);
}

run();
runL2();
runL2Repair();
