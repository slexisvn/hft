import { describe, expect, it } from 'vitest';
import { LevelBitset } from '@hft/book';

function naiveNext(bits: Set<number>, from: number, size: number): number {
  for (let i = from; i < size; i++) if (bits.has(i)) return i;
  return -1;
}
function naivePrev(bits: Set<number>, from: number): number {
  for (let i = from; i >= 0; i--) if (bits.has(i)) return i;
  return -1;
}

describe('LevelBitset', () => {
  it('sets, clears and queries membership', () => {
    const b = new LevelBitset(100);
    b.set(3);
    b.set(64);
    expect(b.has(3)).toBe(true);
    expect(b.has(4)).toBe(false);
    b.clear(3);
    expect(b.has(3)).toBe(false);
  });

  it('finds the next set bit at or above an index, spanning word and summary blocks', () => {
    const b = new LevelBitset(5000);
    b.set(10);
    b.set(2000);
    b.set(4999);
    expect(b.nextSetAtOrAbove(0)).toBe(10);
    expect(b.nextSetAtOrAbove(11)).toBe(2000);
    expect(b.nextSetAtOrAbove(2001)).toBe(4999);
    expect(b.nextSetAtOrAbove(5000)).toBe(-1);
  });

  it('finds the previous set bit at or below an index', () => {
    const b = new LevelBitset(5000);
    b.set(10);
    b.set(2000);
    b.set(4999);
    expect(b.prevSetAtOrBelow(4999)).toBe(4999);
    expect(b.prevSetAtOrBelow(4998)).toBe(2000);
    expect(b.prevSetAtOrBelow(1999)).toBe(10);
    expect(b.prevSetAtOrBelow(9)).toBe(-1);
  });

  it('matches a naive scan under a pseudo-random workload', () => {
    const size = 3000;
    const b = new LevelBitset(size);
    const ref = new Set<number>();
    let s = 987654321;
    const rand = (): number => {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      return s;
    };
    for (let step = 0; step < 20000; step++) {
      const idx = rand() % size;
      if (rand() % 2 === 0) {
        b.set(idx);
        ref.add(idx);
      } else {
        b.clear(idx);
        ref.delete(idx);
      }
      if (step % 50 === 0) {
        const from = rand() % size;
        expect(b.nextSetAtOrAbove(from)).toBe(naiveNext(ref, from, size));
        expect(b.prevSetAtOrBelow(from)).toBe(naivePrev(ref, from));
      }
    }
  });
});
