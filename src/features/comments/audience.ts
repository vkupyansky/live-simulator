import { createPrng } from '@/features/viewers/prng';
import { seedToUint32 } from '@/features/viewers/prng';
import { calculateSessionRosterSize } from '@/features/audience/model';
import {
  PERSONA_IDENTITIES_BY_LANGUAGE,
  type PersonaIdentity,
} from '@/features/comments/usernames';
import { BEHAVIOR_CALIBRATION } from '@/features/comments/behavior';
import type { AudiencePersona, PersonaStyle, TargetViewers } from '@/shared/types/broadcast';

const TONES: PersonaStyle['tone'][] = [
  'short',
  'emoji',
  'question',
  'supportive',
  'casual',
  'slang',
];

function rosterSize(targetViewers: TargetViewers): number {
  return calculateSessionRosterSize(targetViewers);
}

function createPersonaStyle(
  sessionSeed: string | number,
  personaId: string,
  language: 'ru' | 'en',
  frequent: boolean,
): PersonaStyle {
  const random = createPrng(`${sessionSeed}:${personaId}:style`);
  const casingRoll = random.next();
  const casing: PersonaStyle['casing'] =
    casingRoll < BEHAVIOR_CALIBRATION.style.lowerCaseShare
      ? 'lower'
      : casingRoll < 1 - BEHAVIOR_CALIBRATION.style.mixedCaseShare
        ? 'sentence'
        : 'mixed';
  const tone = TONES[seedToUint32(`${sessionSeed}:${personaId}:tone`) % TONES.length] ?? 'casual';
  return {
    casing,
    language,
    tone,
    typoProbability: random.range(
      BEHAVIOR_CALIBRATION.style.typoShare.minimum,
      BEHAVIOR_CALIBRATION.style.typoShare.maximum,
    ),
    emojiProbability: random.range(tone === 'emoji' ? 0.18 : 0.02, tone === 'emoji' ? 0.35 : 0.12),
    activityWeight: frequent ? random.range(2.4, 4.2) : random.range(0.55, 1.65),
  };
}

export function createAudienceRoster(
  targetViewers: TargetViewers,
  seed: string | number,
): AudiencePersona[] {
  const random = createPrng(`${seed}:roster`);
  const size = rosterSize(targetViewers);
  const englishCount = Math.round(size * (1 - BEHAVIOR_CALIBRATION.language.russianShare));
  const languageSlots: Array<'ru' | 'en'> = [
    ...Array.from({ length: size - englishCount }, () => 'ru' as const),
    ...Array.from({ length: englishCount }, () => 'en' as const),
  ];
  for (let index = languageSlots.length - 1; index > 0; index -= 1) {
    const swapIndex = random.integer(0, index);
    const current = languageSlots[index];
    const swap = languageSlots[swapIndex];
    if (!current || !swap) throw new Error('Не удалось распределить языки аудитории.');
    languageSlots[index] = swap;
    languageSlots[swapIndex] = current;
  }
  const identityPools: Record<'ru' | 'en', PersonaIdentity[]> = {
    ru: [...PERSONA_IDENTITIES_BY_LANGUAGE.ru],
    en: [...PERSONA_IDENTITIES_BY_LANGUAGE.en],
  };
  const used = new Set<string>();
  const usedDisplayNames = new Set<string>();
  return Array.from({ length: size }, (_, index) => {
    const primaryLanguage = languageSlots[index];
    if (!primaryLanguage) throw new Error('Язык участника аудитории отсутствует.');
    const identities = identityPools[primaryLanguage];
    let identity: (typeof identities)[number] | undefined;
    while (identities.length > 0 && !identity) {
      const identityIndex = random.integer(0, identities.length - 1);
      const candidate = identities[identityIndex];
      const last = identities.pop();
      if (identityIndex < identities.length && last) identities[identityIndex] = last;
      if (
        candidate &&
        !used.has(candidate.username) &&
        !usedDisplayNames.has(candidate.displayName)
      )
        identity = candidate;
    }
    if (!identity) throw new Error('Локальный набор имён участников отсутствует.');
    const { username, displayName } = identity;
    used.add(username);
    usedDisplayNames.add(displayName);
    const frequent = index < Math.max(3, Math.round(size * 0.12));
    const id = `persona_${index}_${Math.floor(random.next() * 0xffffff).toString(16)}`;
    return {
      id,
      username,
      displayName,
      avatarSeed: `${seed}:${index}:${username}`,
      primaryLanguage,
      style: createPersonaStyle(seed, id, primaryLanguage, frequent),
    };
  });
}
