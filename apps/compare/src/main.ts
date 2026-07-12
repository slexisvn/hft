import { readFileSync } from 'node:fs';
import { columnIndex, loadStrategyConfig, parseCsv, type ParsedCsv } from '@hft/contracts';
import { compareFills, type CompareFill } from '@hft/metrics';

function readFills(path: string): CompareFill[] {
  const csv: ParsedCsv = parseCsv(readFileSync(path, 'utf8'));
  const idIdx = columnIndex(csv.header, 'client_order_id');
  const sizeIdx = columnIndex(csv.header, 'size');
  const priceIdx = columnIndex(csv.header, 'price_ticks');
  const queueIdx = columnIndex(csv.header, 'queue_position_at_fill');
  const out: CompareFill[] = [];
  for (const row of csv.rows) {
    out.push({
      clientOrderId: row[idIdx],
      size: Number(row[sizeIdx]),
      priceTicks: Number(row[priceIdx]),
      queuePositionAtFill: Number(row[queueIdx]),
    });
  }
  return out;
}

function main(): void {
  const configPath = process.argv[2] ?? 'configs/strategy.json';
  const config = loadStrategyConfig(readFileSync(configPath, 'utf8'));

  const sim = readFills(config.output.fillsPath);
  const live = readFills(config.output.liveFillsPath);
  const report = compareFills(sim, live);

  console.log(`sim fills              : ${report.simFillCount} (filled size ${report.simFilledSize})`);
  console.log(`live fills             : ${report.liveFillCount} (filled size ${report.liveFilledSize})`);
  console.log(`matched orders         : ${report.matchedOrders}`);
  console.log(`sim-only orders        : ${report.simOnlyOrders}`);
  console.log(`live-only orders       : ${report.liveOnlyOrders}`);
  console.log(`mean |queue delta|     : ${report.meanAbsQueueDelta.toFixed(4)}`);
  console.log(`mean |vwap delta| ticks: ${report.meanAbsVwapDeltaTicks.toFixed(4)}`);

  if (report.simOnlyOrders > 0 || report.liveOnlyOrders > 0) {
    console.log('note: unmatched fills mean the simulator and live disagree on which orders fill — the core signal');
  }
}

main();
