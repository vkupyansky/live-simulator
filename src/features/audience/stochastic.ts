import type { Prng } from '@/features/viewers/prng';

const EXACT_POISSON_LIMIT = 40;

export function samplePoisson(random: Prng, expected: number): number {
  const lambda = Math.max(0, expected);
  if (lambda === 0) return 0;
  if (lambda <= EXACT_POISSON_LIMIT) {
    const limit = Math.exp(-lambda);
    let product = 1;
    let count = 0;
    do {
      count += 1;
      product *= Math.max(random.next(), Number.EPSILON);
    } while (product > limit);
    return count - 1;
  }

  const left = Math.max(random.next(), Number.EPSILON);
  const right = random.next();
  const normal = Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal));
}
