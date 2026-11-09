import { memo, useMemo } from 'react';
import { getPersonaPortraitUrl } from '@/features/comments/portraits';

export const PersonaAvatar = memo(function PersonaAvatar({ seed }: { seed: string }) {
  const src = useMemo(() => getPersonaPortraitUrl(seed), [seed]);
  return <img className="persona-avatar" src={src} alt="" loading="lazy" decoding="async" />;
});
