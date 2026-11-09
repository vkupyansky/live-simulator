import { seedToUint32 } from '@/features/viewers/prng';

const portraitModules = import.meta.glob<string>('../../assets/personas/portraits/*.webp', {
  eager: true,
  import: 'default',
  query: '?url',
});

export const PERSONA_PORTRAIT_URLS = Object.entries(portraitModules)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, url]) => url);

export const PERSONA_PORTRAIT_COUNT = PERSONA_PORTRAIT_URLS.length;

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function rosterPortraitIndex(seed: string): number | null {
  const match = /^(.*):(\d+):[^:]+$/u.exec(seed);
  if (!match?.[1] || !match[2]) return null;
  const rosterIndex = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(rosterIndex)) return null;

  const sessionHash = seedToUint32(match[1]);
  const offset = sessionHash % PERSONA_PORTRAIT_COUNT;
  let step = seedToUint32(`${match[1]}:portrait-step`) % PERSONA_PORTRAIT_COUNT || 1;
  while (greatestCommonDivisor(step, PERSONA_PORTRAIT_COUNT) !== 1)
    step = (step + 1) % PERSONA_PORTRAIT_COUNT || 1;
  return (offset + rosterIndex * step) % PERSONA_PORTRAIT_COUNT;
}

export function getPersonaPortraitUrl(seed: string): string {
  if (PERSONA_PORTRAIT_COUNT === 0) throw new Error('Набор аватаров участников отсутствует.');
  const index = rosterPortraitIndex(seed) ?? seedToUint32(seed);
  return PERSONA_PORTRAIT_URLS[index % PERSONA_PORTRAIT_COUNT] as string;
}
