import { memo } from 'react';
import type { PersonaBadge as PersonaBadgeType } from '@/shared/types/broadcast';

const LABELS: Record<Exclude<PersonaBadgeType, null>, string> = {
  active: 'Активный участник',
  supporter: 'Поддерживает эфир',
  newcomer: 'Новый участник',
};

export const PersonaBadge = memo(function PersonaBadge({ badge }: { badge: PersonaBadgeType }) {
  if (!badge) return null;
  return (
    <svg
      className={`persona-badge badge-${badge}`}
      viewBox="0 0 16 16"
      role="img"
      aria-label={LABELS[badge]}
    >
      {badge === 'active' && (
        <path d="m8 1.5 2 4 4.5.7-3.2 3.1.8 4.5L8 11.7l-4.1 2.1.8-4.5-3.2-3.1L6 5.5Z" />
      )}
      {badge === 'supporter' && (
        <path d="M8 14S2 10.6 2 6.1C2 2.8 6.1 1.4 8 4c1.9-2.6 6-1.2 6 2.1C14 10.6 8 14 8 14Z" />
      )}
      {badge === 'newcomer' && <path d="M8 1.5 9.8 6l4.7 2L9.8 10 8 14.5 6.2 10 1.5 8l4.7-2Z" />}
    </svg>
  );
});
