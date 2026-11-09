import {
  calculateLikesPerMinute,
  calculateReactionsPerMinute,
  clamp,
} from '@/features/audience/model';
import type { ActivityLevel } from '@/shared/types/broadcast';

export function reactionIntensity(input: {
  currentViewers: number;
  activity: ActivityLevel;
  viewerEventFactor: number;
  commentsPerMinute: number;
  likeBurst: boolean;
}): number {
  const baseRate = calculateReactionsPerMinute(
    calculateLikesPerMinute(input.currentViewers, input.activity),
    input.activity,
  );
  const audienceBase = 0.6 + Math.log1p(baseRate) / 1.7;
  const eventBoost = Math.max(0, input.viewerEventFactor) * 15;
  const chatBoost = input.commentsPerMinute / 20;
  const burstBoost = input.likeBurst ? 1.7 : 0;
  return clamp(audienceBase + eventBoost + chatBoost + burstBoost, 0.5, 10);
}
