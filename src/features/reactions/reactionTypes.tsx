export type ReactionKind = 'heart' | 'spark' | 'star' | 'pulse';

export function ReactionGlyph({ kind }: { kind: ReactionKind }) {
  if (kind === 'heart')
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 28S4 21 4 11.5C4 5 12.5 3 16 9c3.5-6 12-4 12 2.5C28 21 16 28 16 28Z" />
      </svg>
    );
  if (kind === 'spark')
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 2c1.4 8.2 5.8 12.6 14 14-8.2 1.4-12.6 5.8-14 14-1.4-8.2-5.8-12.6-14-14C10.2 14.6 14.6 10.2 16 2Z" />
      </svg>
    );
  if (kind === 'star')
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="m16 2 4.1 9 9.9 1.1-7.4 6.7 2 9.8-8.6-5-8.6 5 2-9.8L2 12.1l9.9-1.1Z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="11" />
      <circle cx="16" cy="16" r="5" fill="#050507" />
    </svg>
  );
}
