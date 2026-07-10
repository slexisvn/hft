import { ConfigError } from '@hft/contracts';
import type { BinanceDepthUpdate } from './transport';

export type DepthSyncState = 'buffering' | 'synced' | 'resync_required';

export type DepthOutcome = 'buffered' | 'applied' | 'discarded' | 'resync_required';

export class DepthSynchronizer {
  private state: DepthSyncState = 'buffering';
  private buffer: BinanceDepthUpdate[] = [];
  private lastFinalUpdateId = -1;
  private resyncs = 0;

  get syncState(): DepthSyncState {
    return this.state;
  }

  get bufferedCount(): number {
    return this.buffer.length;
  }

  get lastAppliedUpdateId(): number {
    return this.lastFinalUpdateId;
  }

  get resyncCount(): number {
    return this.resyncs;
  }

  reset(): void {
    this.state = 'buffering';
    this.buffer = [];
    this.lastFinalUpdateId = -1;
    this.resyncs++;
  }

  accept(update: BinanceDepthUpdate): DepthOutcome {
    if (update.finalUpdateId < update.firstUpdateId) {
      throw new ConfigError(`depth update has finalUpdateId ${update.finalUpdateId} < firstUpdateId ${update.firstUpdateId}`);
    }
    if (this.state === 'buffering') {
      this.buffer.push(update);
      return 'buffered';
    }
    if (this.state === 'resync_required') return 'resync_required';

    if (update.finalUpdateId <= this.lastFinalUpdateId) return 'discarded';
    if (update.firstUpdateId !== this.lastFinalUpdateId + 1) {
      this.state = 'resync_required';
      return 'resync_required';
    }
    this.lastFinalUpdateId = update.finalUpdateId;
    return 'applied';
  }

  applySnapshot(snapshotLastUpdateId: number): readonly BinanceDepthUpdate[] {
    const pending: BinanceDepthUpdate[] = [];
    for (const update of this.buffer) {
      if (update.finalUpdateId <= snapshotLastUpdateId) continue;
      pending.push(update);
    }
    this.buffer = [];

    if (pending.length === 0) {
      this.state = 'synced';
      this.lastFinalUpdateId = snapshotLastUpdateId;
      return pending;
    }

    const first = pending[0];
    if (first.firstUpdateId > snapshotLastUpdateId + 1) {
      this.state = 'resync_required';
      return [];
    }

    let last = snapshotLastUpdateId;
    for (const update of pending) {
      if (update.finalUpdateId <= last) continue;
      if (update.firstUpdateId > last + 1) {
        this.state = 'resync_required';
        return [];
      }
      last = update.finalUpdateId;
    }

    this.state = 'synced';
    this.lastFinalUpdateId = last;
    return pending;
  }
}
