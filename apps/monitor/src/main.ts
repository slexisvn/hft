import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadStrategyConfig } from '@hft/contracts';
import { createReplaySource, createStatsSource } from './source';
import { startMonitorServer } from './server';

const DEFAULT_PORT = 8787;
const RECENT_FILLS_LIMIT = 50;
const STATIC_DIR = 'ui/dist';
const REPLAY_FLAG = '--replay';

function resolvePort(): number {
  const fromEnv = Number(process.env.PORT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_PORT;
}

function resolveConfigPath(): string {
  const positional = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  return positional ?? 'configs/strategy.json';
}

function main(): void {
  const config = loadStrategyConfig(readFileSync(resolveConfigPath(), 'utf8'));
  const replay = process.argv.includes(REPLAY_FLAG);
  const source = replay
    ? createReplaySource(config, RECENT_FILLS_LIMIT)
    : createStatsSource(config, RECENT_FILLS_LIMIT);
  const port = resolvePort();
  const staticDir = resolve(STATIC_DIR);

  startMonitorServer({ port, staticDir, source });

  console.log(`monitor strategy       : ${config.strategy.kind}`);
  console.log(`monitor symbol         : ${config.instrument.symbol}`);
  console.log(`telemetry source       : ${replay ? 'replay (out/fills.csv)' : 'live session (idle)'}`);
  console.log(`stats endpoint         : http://localhost:${port}/stats`);
  console.log(`static dir             : ${staticDir}`);
  console.log(`live fills path        : ${config.output.liveFillsPath}`);
}

main();
