import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ConfigError,
  LIVE_FILLS_SCHEMA,
  LINEAR_MODEL_SPEC,
  csvHeader,
  csvRow,
  fillRow,
  loadStrategyConfig,
  validate,
  type FillRecord,
  type LinearModelArtifact,
  type StrategyConfig,
} from '@hft/contracts';
import {
  ClientOrderIdGenerator,
  GuardedGateway,
  KillSwitch,
  LiveSession,
  OrderRegistry,
  PaperGateway,
  RealSchedulingClock,
  TokenBucket,
  type AccountSnapshot,
} from '@hft/live';
import { createTickScale } from '@hft/events';
import { createStrategy } from '@hft/strategy';
import { BinanceGateway, binanceEndpoints } from '@hft/binance';

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadModel(config: StrategyConfig): LinearModelArtifact | null {
  if (config.strategy.kind !== 'linear') return null;
  const raw = JSON.parse(readFileSync(config.strategy.modelPath, 'utf8')) as unknown;
  return validate(LINEAR_MODEL_SPEC, raw) as LinearModelArtifact;
}

function main(): void {
  const configPath = process.argv[2] ?? 'configs/strategy.json';
  const dryRun = process.argv.indexOf('--dry-run') >= 0;
  const paperMode = process.argv.indexOf('--paper') >= 0;
  const config = loadStrategyConfig(readFileSync(configPath, 'utf8'));

  const clock = new RealSchedulingClock();
  const strategy = createStrategy(config.strategy, loadModel(config));
  const ids = new ClientOrderIdGenerator(config.name, Math.floor(clock.now() / 1_000_000));
  const endpoints = binanceEndpoints(config.live, config.instrument.symbol, '<listen-key>');

  ensureDir(config.output.liveFillsPath);
  if (!existsSync(config.output.liveFillsPath)) {
    writeFileSync(config.output.liveFillsPath, `${csvHeader(LIVE_FILLS_SCHEMA)}\n`, 'utf8');
  }
  const liveFills: FillRecord[] = [];

  const transport = paperMode
    ? new PaperGateway(
        {
          minPriceTicks: config.instrument.minPriceTicks,
          maxPriceTicks: config.instrument.maxPriceTicks,
          initialOrderCapacity: config.sim.initialOrderCapacity,
          snapshotDepth: config.book.snapshotDepth,
          decisionLatencyNs: config.latency.decisionNs,
          orderEntryLatencyNs: config.latency.orderEntryNs,
          makerFeeBps: config.sim.makerFeeBps,
          takerFeeBps: config.sim.takerFeeBps,
        },
        clock,
        {
          onFill(fill: FillRecord): void {
            liveFills.push(fill);
            appendFileSync(config.output.liveFillsPath, `${csvRow(fillRow(fill))}\n`, 'utf8');
          },
          onOrderRejected(clientOrderId: string, reason: string): void {
            console.error(`order rejected ${clientOrderId}: ${reason}`);
          },
        },
      )
    : new BinanceGateway(
        { minPriceTicks: config.instrument.minPriceTicks, maxPriceTicks: config.instrument.maxPriceTicks },
        createTickScale(config.instrument.tickSize, config.instrument.priceScale),
        clock,
        null,
        {
          onFill(fill: FillRecord): void {
            liveFills.push(fill);
            appendFileSync(config.output.liveFillsPath, `${csvRow(fillRow(fill))}\n`, 'utf8');
          },
          onOrderRejected: (clientOrderId, reason) => console.error(`order rejected ${clientOrderId}: ${reason}`),
          onResyncRequired: () => console.error('depth stream out of sync: snapshot resync required'),
        },
      );

  const killSwitch = new KillSwitch(
    {
      maxPosition: config.risk.maxPosition,
      maxLossTicks: config.risk.maxLossTicks,
      maxOrdersPerSecond: config.risk.maxOrdersPerSecond,
      maxReconcileDrift: config.risk.reconcileToleranceQty,
    },
    clock,
    transport,
  );

  const guarded = new GuardedGateway(
    transport,
    new TokenBucket(config.live.rateLimit.capacityTokens, config.live.rateLimit.refillTokensPerSecond, clock),
    killSwitch,
    new OrderRegistry(),
    {
      onOrderRejected: (clientOrderId, reason) => console.error(`order rejected ${clientOrderId}: ${reason}`),
      onHalted: (reason) => console.error(`HALTED: ${reason}`),
    },
  );

  const session = new LiveSession(
    clock,
    guarded,
    {
      reconcileIntervalNs: config.live.reconcileIntervalNs,
      reconcileToleranceQty: config.risk.reconcileToleranceQty,
      resyncOnSequenceGap: config.live.resyncOnSequenceGap,
    },
    {
      fetchExchangeAccount: (): AccountSnapshot => {
        throw new ConfigError('no exchange account transport is injected: reconcile cannot run');
      },
      resyncOrderBookSnapshot: () => console.error('sequence gap: order book snapshot resync required'),
      onReconcile: (r) => console.log(`reconcile drift=${r.positionDrift} breach=${r.breach}`),
    },
  );

  console.log(`strategy               : ${strategy.name}`);
  console.log(`transport              : ${paperMode ? 'paper' : 'binance (no network transport injected)'}`);
  console.log(`clock now (ns)         : ${clock.now()}`);
  console.log(`next client order id   : ${ids.at(0, ids.nextSeq)}`);
  console.log(`kill switch tripped    : ${killSwitch.tripped}`);
  console.log(`gateway halted         : ${guarded.isHalted}`);
  console.log(`reconcile interval (ns): ${config.live.reconcileIntervalNs}`);
  console.log(`resync on seq gap      : ${config.live.resyncOnSequenceGap}`);
  console.log(`depth stream           : ${endpoints.depthStream}`);
  console.log(`order rest             : ${endpoints.orderRest}`);
  console.log(`live fills schema      : ${LIVE_FILLS_SCHEMA.name} v${LIVE_FILLS_SCHEMA.version}`);
  console.log(`live fills path        : ${config.output.liveFillsPath}`);

  if (dryRun) {
    console.log('dry run: wiring validated, no market data feed and no network transport attempted');
    return;
  }
  session.start();
  throw new ConfigError(
    'no market data feed is injected: BinanceGateway has the book and order logic but no WebSocket transport. Re-run with --dry-run, or inject an OrderTransport and pump onDepthUpdate/onTrade/onExecutionReport.',
  );
}

main();
