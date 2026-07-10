import type { SchedulingClock } from '@hft/contracts';
import { GuardedGateway } from './guarded_gateway';
import { reconcile, type AccountSnapshot, type ReconcileResult } from './reconcile';
import { SequenceTracker, type SequenceOutcome } from './sequence';

export interface LiveSessionOptions {
  readonly reconcileIntervalNs: number;
  readonly reconcileToleranceQty: number;
  readonly resyncOnSequenceGap: boolean;
}

export interface LiveSessionHooks {
  fetchExchangeAccount(): AccountSnapshot;
  resyncOrderBookSnapshot(): void;
  onReconcile(result: ReconcileResult): void;
}

export class LiveSession {
  private readonly clock: SchedulingClock;
  private readonly gateway: GuardedGateway;
  private readonly opts: LiveSessionOptions;
  private readonly hooks: LiveSessionHooks;
  private readonly sequence: SequenceTracker;
  private running = false;
  private resyncs = 0;
  private reconciles = 0;

  constructor(clock: SchedulingClock, gateway: GuardedGateway, opts: LiveSessionOptions, hooks: LiveSessionHooks) {
    this.clock = clock;
    this.gateway = gateway;
    this.opts = opts;
    this.hooks = hooks;
    this.sequence = new SequenceTracker(opts.resyncOnSequenceGap);
  }

  get isRunning(): boolean {
    return this.running && !this.gateway.isHalted;
  }

  get resyncCount(): number {
    return this.resyncs;
  }

  get reconcileCount(): number {
    return this.reconciles;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleReconcile();
  }

  stop(): void {
    this.running = false;
  }

  onSequence(sequence: number): SequenceOutcome {
    const outcome = this.sequence.accept(sequence);
    if (outcome === 'gap') {
      this.resyncs++;
      this.sequence.reset(sequence + 1);
      this.hooks.resyncOrderBookSnapshot();
    }
    return outcome;
  }

  reconcileNow(): ReconcileResult {
    this.reconciles++;
    const local: AccountSnapshot = {
      position: this.gateway.position(),
      openOrders: this.gateway.openOrders(),
    };
    const remote = this.hooks.fetchExchangeAccount();
    const result = reconcile(local, remote, this.opts.reconcileToleranceQty);
    this.hooks.onReconcile(result);

    if (Math.abs(result.positionDrift) > this.opts.reconcileToleranceQty) {
      this.gateway.onReconcileDrift(result.positionDrift);
    } else if (result.breach) {
      this.gateway.halt();
    }
    return result;
  }

  private scheduleReconcile(): void {
    this.clock.schedule(this.clock.now() + this.opts.reconcileIntervalNs, () => {
      if (!this.isRunning) return;
      this.reconcileNow();
      if (this.isRunning) this.scheduleReconcile();
    });
  }
}
