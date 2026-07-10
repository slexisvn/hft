import { NO_PRICE, SIDE_ASK, SIDE_BID, type BookView, type LevelView } from '@hft/contracts';
import { makeLevelViews } from './book';

export interface L2Snapshot {
  readonly depth: number;
  timestampNs: number;
  readonly bidPriceTicks: Int32Array;
  readonly bidSize: Int32Array;
  readonly askPriceTicks: Int32Array;
  readonly askSize: Int32Array;
}

export class SnapshotWriter {
  private readonly scratch: LevelView[];
  readonly snapshot: L2Snapshot;

  constructor(depth: number) {
    this.scratch = makeLevelViews(depth);
    this.snapshot = {
      depth,
      timestampNs: 0,
      bidPriceTicks: new Int32Array(depth),
      bidSize: new Int32Array(depth),
      askPriceTicks: new Int32Array(depth),
      askSize: new Int32Array(depth),
    };
  }

  capture(book: BookView): L2Snapshot {
    const d = this.snapshot.depth;
    const s = this.snapshot;
    s.timestampNs = book.timestampNs;

    const nb = book.depth(SIDE_BID, d, this.scratch);
    for (let i = 0; i < d; i++) {
      s.bidPriceTicks[i] = i < nb ? this.scratch[i].priceTicks : NO_PRICE;
      s.bidSize[i] = i < nb ? this.scratch[i].size : 0;
    }

    const na = book.depth(SIDE_ASK, d, this.scratch);
    for (let i = 0; i < d; i++) {
      s.askPriceTicks[i] = i < na ? this.scratch[i].priceTicks : NO_PRICE;
      s.askSize[i] = i < na ? this.scratch[i].size : 0;
    }
    return s;
  }
}
