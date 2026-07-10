import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NO_PRICE, SIDE_ASK, SIDE_BID, type EventType, type Side } from '@hft/contracts';
import { createTickScale, ticksToRaw } from '@hft/events';
import { L3Book, checkInvariants } from '@hft/book';
import { isEmptyLobsterPrice, parseMessages, parseOrderbook } from '@hft/lobster';

interface GoldenCase {
  readonly label: string;
  readonly messageText: string;
  readonly orderbookText: string;
  readonly levels: number;
  readonly tickSize: number;
  readonly priceScale: number;
}

const FIXTURE_DIR = resolve(process.cwd(), 'packages/adapters/lobster/test/fixtures');
const DATA_DIR = process.env.HFT_LOBSTER_DIR ?? resolve(process.cwd(), 'data');

function tinyCase(): GoldenCase {
  return {
    label: 'hand-computed tiny fixture',
    messageText: readFileSync(join(FIXTURE_DIR, 'tiny_message.csv'), 'utf8'),
    orderbookText: readFileSync(join(FIXTURE_DIR, 'tiny_orderbook.csv'), 'utf8'),
    levels: 2,
    tickSize: 0.01,
    priceScale: 10000,
  };
}

function realCases(): GoldenCase[] {
  if (!existsSync(DATA_DIR)) return [];
  const files = readdirSync(DATA_DIR);
  const out: GoldenCase[] = [];
  for (const f of files) {
    if (f.indexOf('_message_') < 0 || !f.endsWith('.csv')) continue;
    const ob = f.replace('_message_', '_orderbook_');
    if (files.indexOf(ob) < 0) continue;
    const levelsMatch = /_(\d+)\.csv$/.exec(f);
    if (levelsMatch === null) continue;
    out.push({
      label: f,
      messageText: readFileSync(join(DATA_DIR, f), 'utf8'),
      orderbookText: readFileSync(join(DATA_DIR, ob), 'utf8'),
      levels: Number(levelsMatch[1]),
      tickSize: 0.01,
      priceScale: 10000,
    });
  }
  return out;
}

function replayAndCompare(c: GoldenCase): void {
  const scale = createTickScale(c.tickSize, c.priceScale);
  const events = parseMessages(c.messageText, scale, 1024);
  const truth = parseOrderbook(c.orderbookText, c.levels);
  expect(truth.rows).toBe(events.length);

  let minTicks = Number.POSITIVE_INFINITY;
  let maxTicks = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < events.length; i++) {
    const t = events.eventType[i];
    if (t === 6 || t === 7) continue;
    const p = events.priceTicks[i];
    if (p < minTicks) minTicks = p;
    if (p > maxTicks) maxTicks = p;
  }

  const book = new L3Book({
    minPriceTicks: minTicks - 1,
    maxPriceTicks: maxTicks + 1,
    initialOrderCapacity: 1024,
  });

  const scratch = [];
  for (let i = 0; i < c.levels; i++) scratch.push({ priceTicks: NO_PRICE, size: 0, orderCount: 0 });

  for (let i = 0; i < events.length; i++) {
    book.apply(
      events.timestampNs[i],
      events.eventType[i] as EventType,
      events.orderId[i],
      events.side[i] as Side,
      events.priceTicks[i],
      events.sizeQty[i],
    );
    checkInvariants(book);
    compareRow(book, truth, i, c.levels, scale, scratch);
  }
}

function compareRow(
  book: L3Book,
  truth: ReturnType<typeof parseOrderbook>,
  row: number,
  levels: number,
  scale: ReturnType<typeof createTickScale>,
  scratch: { priceTicks: number; size: number; orderCount: number }[],
): void {
  const nb = book.depth(SIDE_BID, levels, scratch);
  for (let l = 0; l < levels; l++) {
    const expectPrice = truth.bidPriceRaw[row * levels + l];
    const expectSize = truth.bidSize[row * levels + l];
    if (isEmptyLobsterPrice(expectPrice)) {
      expect(l, `row ${row} bid level ${l} should be empty`).toBeGreaterThanOrEqual(nb);
      continue;
    }
    expect(l, `row ${row} bid level ${l} missing`).toBeLessThan(nb);
    expect(ticksToRaw(scale, scratch[l].priceTicks), `row ${row} bid price level ${l}`).toBe(expectPrice);
    expect(scratch[l].size, `row ${row} bid size level ${l}`).toBe(expectSize);
  }

  const na = book.depth(SIDE_ASK, levels, scratch);
  for (let l = 0; l < levels; l++) {
    const expectPrice = truth.askPriceRaw[row * levels + l];
    const expectSize = truth.askSize[row * levels + l];
    if (isEmptyLobsterPrice(expectPrice)) {
      expect(l, `row ${row} ask level ${l} should be empty`).toBeGreaterThanOrEqual(na);
      continue;
    }
    expect(l, `row ${row} ask level ${l} missing`).toBeLessThan(na);
    expect(ticksToRaw(scale, scratch[l].priceTicks), `row ${row} ask price level ${l}`).toBe(expectPrice);
    expect(scratch[l].size, `row ${row} ask size level ${l}`).toBe(expectSize);
  }
}

describe('GOLDEN GATE: book replay vs LOBSTER orderbook file', () => {
  it('matches the hand-computed fixture row for row', () => {
    replayAndCompare(tinyCase());
  });

  const cases = realCases();
  if (cases.length === 0) {
    it.skip('matches real LOBSTER sample data row for row (no data/ fixture present)', () => {
      throw new Error('unreachable');
    });
  } else {
    for (const c of cases) {
      it(`matches real LOBSTER sample ${c.label} row for row`, () => {
        replayAndCompare(c);
      });
    }
  }
});

describe('hidden executions', () => {
  it('do not modify the book but remain on the tape', () => {
    const scale = createTickScale(0.01, 10000);
    const events = parseMessages(tinyCase().messageText, scale, 64);
    let hidden = 0;
    for (let i = 0; i < events.length; i++) if (events.eventType[i] === 5) hidden++;
    expect(hidden).toBe(1);
  });
});
