import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactionGlyph, type ReactionKind } from '@/features/reactions/reactionTypes';
import { createPrng } from '@/features/viewers/prng';

interface ReactionItem {
  id: number;
  kind: ReactionKind;
  x: number;
  drift: number;
  scale: number;
  duration: number;
  color: string;
}

const KINDS: ReactionKind[] = ['heart', 'spark', 'star', 'pulse'];
const COLORS = ['#fe2c55', '#25f4ee', '#ff4d8d', '#ffd166', '#ffffff'];
const POOL_LIMIT = 18;

export function ReactionLayer({
  intensity,
  manualSignal,
  seed,
}: {
  intensity: number;
  manualSignal: number;
  seed: number;
}) {
  const [items, setItems] = useState<ReactionItem[]>([]);
  const sequence = useRef(0);
  const random = useMemo(() => createPrng(seed ^ 0x3f4a21), [seed]);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (query.matches) setItems([]);
      setReduced(query.matches);
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const update = () => {
      if (document.hidden) setItems([]);
      setHidden(document.hidden);
    };
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  const spawn = useCallback(() => {
    if (hidden || reduced) return;
    const id = ++sequence.current;
    const item: ReactionItem = {
      id,
      kind: KINDS[Math.floor(random.next() * KINDS.length)] ?? 'heart',
      x: random.range(-12, 14),
      drift: random.range(-70, 46),
      scale: random.range(0.75, 1.28),
      duration: random.range(2100, 3400),
      color: COLORS[Math.floor(random.next() * COLORS.length)] ?? '#fe2c55',
    };
    setItems((previous) => [...previous.slice(-(POOL_LIMIT - 1)), item]);
  }, [hidden, random, reduced]);

  useEffect(() => {
    if (intensity <= 0 || reduced || hidden) return;
    const timer = setInterval(spawn, Math.max(260, 1800 - intensity * 145));
    return () => clearInterval(timer);
  }, [hidden, intensity, reduced, spawn]);
  useEffect(() => {
    if (manualSignal > 0) spawn();
  }, [manualSignal, spawn]);

  return (
    <div className="reaction-layer" aria-hidden="true">
      {items.map((item) => (
        <span
          key={item.id}
          className="reaction"
          onAnimationEnd={() =>
            setItems((current) => current.filter((candidate) => candidate.id !== item.id))
          }
          style={
            {
              '--reaction-x': `${item.x}px`,
              '--reaction-drift': `${item.drift}px`,
              '--reaction-scale': item.scale,
              '--reaction-duration': `${item.duration}ms`,
              '--reaction-color': item.color,
            } as React.CSSProperties
          }
        >
          <ReactionGlyph kind={item.kind} />
        </span>
      ))}
    </div>
  );
}
