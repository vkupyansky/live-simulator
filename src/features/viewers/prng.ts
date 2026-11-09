export interface Prng {
  next(): number;
  range(min: number, max: number): number;
  integer(min: number, max: number): number;
}

export function seedToUint32(seed: string | number): number {
  if (typeof seed === 'number') return (Number.isFinite(seed) ? seed : 0) >>> 0;
  let hash = 2_166_136_261;
  for (const character of seed.normalize('NFKC')) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function createPrng(seed: string | number): Prng {
  let state = seedToUint32(seed);
  if (state === 0) state = 0x6d2b79f5;
  return {
    next() {
      state += 0x6d2b79f5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    },
    range(min, max) {
      return min + this.next() * (max - min);
    },
    integer(min, max) {
      return Math.floor(this.range(min, max + 1));
    },
  };
}
