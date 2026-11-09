import type { PersonaBadge } from '@/shared/types/broadcast';

function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function getPersonaBadge(sessionSeed: string | number, avatarSeed: string): PersonaBadge {
  const bucket = hashSeed(`${sessionSeed}:${avatarSeed}:badge`) % 100;
  if (bucket < 92) return null;
  if (bucket < 95) return 'newcomer';
  if (bucket < 98) return 'active';
  return 'supporter';
}
