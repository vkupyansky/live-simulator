import { calculateLikesPerMinute, clamp } from '@/features/audience/model';
import { samplePoisson } from '@/features/audience/stochastic';
import { createPrng, type Prng } from '@/features/viewers/prng';
import type { ActivityLevel } from '@/shared/types/broadcast';

const SYNTHETIC_AGE_MINUTES = 3;
const SYNTHETIC_AGE_MAX_MINUTES = 8;

export function likesPerMinute(viewers: number, activity: ActivityLevel): number {
  return calculateLikesPerMinute(viewers, activity);
}

export interface LikeTickContext {
  now: number;
  currentViewers: number;
  viewerEventFactor: number;
  commentsPerMinute: number;
}

export interface LikeState {
  value: number;
  burst: boolean;
  increment: number;
}

export class LikeEngine {
  private readonly random: Prng;
  private value: number;
  private lastAt: number;

  constructor(
    private readonly activity: ActivityLevel,
    seed: string | number,
    now: number,
    viewers: number,
  ) {
    this.random = createPrng(`${seed}:likes`);
    this.lastAt = now;
    const ageMinutes = this.random.range(SYNTHETIC_AGE_MINUTES, SYNTHETIC_AGE_MAX_MINUTES);
    const baseline = likesPerMinute(viewers, activity) * ageMinutes;
    this.value = Math.max(1, Math.round(baseline * this.random.range(0.84, 1.18)));
  }

  tick(context: LikeTickContext): LikeState {
    const elapsedSeconds = clamp((context.now - this.lastAt) / 1000, 0, 3);
    this.lastAt = context.now;
    const engagement = clamp(
      1 + Math.max(0, context.viewerEventFactor) * 2.1 + context.commentsPerMinute / 180,
      0.8,
      1.65,
    );
    const expected =
      (likesPerMinute(context.currentViewers, this.activity) * engagement * elapsedSeconds) / 60;
    const burstChance = clamp(
      elapsedSeconds *
        (0.012 + Math.max(0, context.viewerEventFactor) * 0.32 + context.commentsPerMinute / 1_500),
      0,
      0.28,
    );
    const burst = elapsedSeconds > 0 && this.random.next() < burstChance;
    const increment =
      samplePoisson(this.random, expected) +
      (burst ? samplePoisson(this.random, Math.max(1, expected * this.random.range(0.8, 2.2))) : 0);
    this.value += increment;
    return { value: this.value, burst, increment };
  }

  snapshot(): number {
    return this.value;
  }
}
