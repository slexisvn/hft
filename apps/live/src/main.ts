import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ConfigError,
  LIQ_MAKER,
  LIVE_FILLS_SCHEMA,
  LINEAR_MODEL_SPEC,
  cashDeltaTicks,
  csvHeader,
  csvRow,
  fillRow,
  loadStrategyConfig,
  markToMarketTicks,
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
import {
  BinanceGateway,
  BinanceRestClient,
  BinanceRestTransport,
  SnapshotCache,
  binanceEndpoints,
  dispatchFeedMessage,
  parseAccountSnapshot,
} from '@hft/binance';
import { FileIdJournal } from './id_journal';

function decimalsOf(step: number): number {
  if (step >= 1) return 0;
  return Math.max(0, Math.round(-Math.log10(step)));
}

function baseAssetOf(symbol: string): string {
  for (const quote of ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH']) {
    if (symbol.length > quote.length && symbol.endsWith(quote)) return symbol.slice(0, -quote.length);
  }
  return symbol;
}

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
  const strategy = createStrategy(config.strategy, loadModel(config), {
    ofiWindowNs: config.metrics.ofiWindowNs,
    snapshotDepth: config.book.snapshotDepth,
  });
  const ids = new ClientOrderIdGenerator(config.name, Math.floor(clock.now() / 1_000_000));
  const endpoints = binanceEndpoints(config.live, config.instrument.symbol, '<listen-key>');
  const scale = createTickScale(config.instrument.tickSize, config.instrument.priceScale);

  const apiKey = process.env.BINANCE_API_KEY ?? '';
  const apiSecret = process.env.BINANCE_API_SECRET ?? '';
  const restClient =
    apiKey.length > 0 && apiSecret.length > 0
      ? new BinanceRestClient(config.live.restEndpoint, { apiKey, apiSecret })
      : null;
  const restTransport =
    restClient === null
      ? null
      : new BinanceRestTransport(
          restClient,
          scale,
          {
            symbol: config.instrument.symbol,
            pricePrecision: decimalsOf(config.instrument.tickSize),
            quantityPrecision: decimalsOf(config.instrument.lotSize),
            lotSize: config.instrument.lotSize,
          },
          { onError: (id, e) => console.error(`transport error ${id}: ${e.message}`) },
        );
  const accountCache = new SnapshotCache<AccountSnapshot>();

  ensureDir(config.output.liveFillsPath);
  if (!existsSync(config.output.liveFillsPath)) {
    writeFileSync(config.output.liveFillsPath, `${csvHeader(LIVE_FILLS_SCHEMA)}\n`, 'utf8');
  }
  const liveFills: FillRecord[] = [];
  let cashTicks = 0;

  const recordFill = (fill: FillRecord): void => {
    liveFills.push(fill);
    cashTicks += cashDeltaTicks(
      fill.side,
      fill.priceTicks,
      fill.size,
      fill.liquidity === LIQ_MAKER ? config.sim.makerFeeBps : config.sim.takerFeeBps,
    );
    appendFileSync(config.output.liveFillsPath, `${csvRow(fillRow(fill))}\n`, 'utf8');
  };
  const logReject = (clientOrderId: string, reason: string): void =>
    console.error(`order rejected ${clientOrderId}: ${reason}`);

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
        { onFill: recordFill, onOrderRejected: logReject },
      )
    : new BinanceGateway(
        { minPriceTicks: config.instrument.minPriceTicks, maxPriceTicks: config.instrument.maxPriceTicks },
        scale,
        clock,
        restTransport,
        {
          onFill: recordFill,
          onOrderRejected: logReject,
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

  const idJournal = new FileIdJournal(`${dirname(config.output.liveFillsPath)}/sent_client_order_ids.log`);
  const guarded = new GuardedGateway(
    transport,
    new TokenBucket(config.live.rateLimit.capacityTokens, config.live.rateLimit.refillTokensPerSecond, clock),
    killSwitch,
    new OrderRegistry(),
    {
      onOrderRejected: (clientOrderId, reason) => console.error(`order rejected ${clientOrderId}: ${reason}`),
      onHalted: (reason) => console.error(`HALTED: ${reason}`),
    },
    idJournal,
  );
  const resumedIds = idJournal.load();
  guarded.restoreSentIds(resumedIds);

  const session = new LiveSession(
    clock,
    guarded,
    {
      reconcileIntervalNs: config.live.reconcileIntervalNs,
      reconcileToleranceQty: config.risk.reconcileToleranceQty,
      resyncOnSequenceGap: config.live.resyncOnSequenceGap,
    },
    {
      fetchExchangeAccount: (): AccountSnapshot => accountCache.require(),
      resyncOrderBookSnapshot: () => console.error('sequence gap: order book snapshot resync required'),
      onReconcile: (r) => console.log(`reconcile drift=${r.positionDrift} breach=${r.breach}`),
      markToMarketPnlTicks: () => markToMarketTicks(cashTicks, guarded.position(), guarded.marketView().midTicks()),
    },
  );

  const feedTarget = paperMode ? null : (transport as BinanceGateway);
  const onFeedMessage = feedTarget === null ? null : (raw: string): void => dispatchFeedMessage(raw, feedTarget, scale);
  let openOrdersReloaded = false;
  const refreshAccount = async (): Promise<void> => {
    if (restClient === null) return;
    try {
      const [time, account, open] = await Promise.all([
        restClient.getServerTime(),
        restClient.getAccount(),
        restClient.getOpenOrders(config.instrument.symbol),
      ]);
      const serverTimeMs = Number((JSON.parse(time.body) as { serverTime?: number }).serverTime);
      if (Number.isFinite(serverTimeMs)) clock.resync(serverTimeMs);
      const snapshot = parseAccountSnapshot(account.body, open.body, scale, baseAssetOf(config.instrument.symbol));
      accountCache.set(snapshot, clock.now());
      if (!openOrdersReloaded) {
        guarded.restoreOpenOrders(snapshot.openOrders);
        openOrdersReloaded = true;
      }
    } catch (err) {
      console.error(`account refresh failed: ${(err as Error).message}`);
    }
  };

  console.log(`strategy               : ${strategy.name}`);
  console.log(`transport              : ${paperMode ? 'paper' : restTransport === null ? 'binance (no credentials in env)' : 'binance REST'}`);
  console.log(`account refresh        : ${restClient === null ? 'disabled (set BINANCE_API_KEY/SECRET)' : 'enabled'}`);
  console.log(`ws dispatch            : ${onFeedMessage === null ? 'n/a (paper)' : 'ready (connect a socket to feed it)'}`);
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
  if (restClient !== null) {
    void refreshAccount();
  }
  session.start();
  throw new ConfigError(
    'order REST + account reconcile are wired (set BINANCE_API_KEY/SECRET), but no WebSocket market-data socket is connected: ' +
      'open the depth/trade/user streams and pipe each frame into onFeedMessage(...). Re-run with --dry-run to validate wiring only.',
  );
}

main();
