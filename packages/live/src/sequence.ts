import { SequenceGapError } from '@hft/contracts';

export type SequenceOutcome = 'ok' | 'duplicate' | 'gap';

export class SequenceTracker {
  private readonly resyncOnGap: boolean;
  private expected = -1;
  private gaps = 0;

  constructor(resyncOnGap: boolean) {
    this.resyncOnGap = resyncOnGap;
  }

  get gapCount(): number {
    return this.gaps;
  }

  get nextExpected(): number {
    return this.expected;
  }

  reset(firstSequence: number): void {
    this.expected = firstSequence;
  }

  accept(sequence: number): SequenceOutcome {
    if (this.expected < 0) {
      this.expected = sequence + 1;
      return 'ok';
    }
    if (sequence < this.expected) return 'duplicate';
    if (sequence === this.expected) {
      this.expected = sequence + 1;
      return 'ok';
    }
    this.gaps++;
    if (!this.resyncOnGap) throw new SequenceGapError(this.expected, sequence);
    return 'gap';
  }
}
