const WORD_BITS = 32;

export class LevelBitset {
  private readonly size: number;
  private readonly words: Uint32Array;
  private readonly summary: Uint32Array;

  constructor(size: number) {
    this.size = size;
    const wordCount = Math.ceil(size / WORD_BITS);
    this.words = new Uint32Array(wordCount);
    this.summary = new Uint32Array(Math.ceil(wordCount / WORD_BITS));
  }

  clearAll(): void {
    this.words.fill(0);
    this.summary.fill(0);
  }

  set(index: number): void {
    const w = index >>> 5;
    this.words[w] |= 1 << (index & 31);
    this.summary[w >>> 5] |= 1 << (w & 31);
  }

  clear(index: number): void {
    const w = index >>> 5;
    this.words[w] &= ~(1 << (index & 31));
    if (this.words[w] === 0) this.summary[w >>> 5] &= ~(1 << (w & 31));
  }

  has(index: number): boolean {
    return (this.words[index >>> 5] & (1 << (index & 31))) !== 0;
  }

  nextSetAtOrAbove(index: number): number {
    if (index >= this.size) return -1;
    let w = index >>> 5;
    let word = this.words[w] & (0xffffffff << (index & 31));
    if (word !== 0) return w * WORD_BITS + trailingZeros(word);
    let s = w >>> 5;
    let block = this.summary[s] & (0xfffffffe << (w & 31));
    for (;;) {
      if (block !== 0) {
        w = s * WORD_BITS + trailingZeros(block);
        return w * WORD_BITS + trailingZeros(this.words[w]);
      }
      s++;
      if (s >= this.summary.length) return -1;
      block = this.summary[s];
    }
  }

  prevSetAtOrBelow(index: number): number {
    if (index < 0) return -1;
    let w = index >>> 5;
    const bit = index & 31;
    const mask = bit === 31 ? 0xffffffff : (1 << (bit + 1)) - 1;
    let word = this.words[w] & mask;
    if (word !== 0) return w * WORD_BITS + (31 - leadingZeros(word));
    let s = w >>> 5;
    let block = this.summary[s] & ((1 << (w & 31)) - 1);
    for (;;) {
      if (block !== 0) {
        w = s * WORD_BITS + (31 - leadingZeros(block));
        return w * WORD_BITS + (31 - leadingZeros(this.words[w]));
      }
      if (s === 0) return -1;
      s--;
      block = this.summary[s];
    }
  }
}

function trailingZeros(word: number): number {
  return 31 - leadingZeros(word & -word);
}

function leadingZeros(word: number): number {
  return Math.clz32(word);
}
