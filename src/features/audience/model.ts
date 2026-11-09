import type { ActivityLevel, TargetViewers } from '@/shared/types/broadcast';
import { BEHAVIOR_CALIBRATION } from '@/features/comments/behavior';

export const ACTIVITY_MULTIPLIER = BEHAVIOR_CALIBRATION.messageRate.activityMultiplier;

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function calculateCommentsPerMinute(
  currentViewers: number,
  activity: ActivityLevel,
): number {
  const calibration = BEHAVIOR_CALIBRATION.messageRate;
  return clamp(
    calibration.messagesPerMinuteAt100Viewers *
      Math.pow(Math.max(0, currentViewers) / 100, calibration.viewerExponent) *
      calibration.activityMultiplier[activity],
    calibration.minimum,
    calibration.maximum,
  );
}

export function calculateLikesPerMinute(currentViewers: number, activity: ActivityLevel): number {
  return clamp(
    (0.8 + 0.9 * Math.pow(Math.max(0, currentViewers), 0.78)) * ACTIVITY_MULTIPLIER[activity],
    1,
    6_000,
  );
}

export function calculateReactionsPerMinute(
  likesPerMinute: number,
  activity: ActivityLevel,
): number {
  const share = activity === 'high' ? 0.34 : activity === 'normal' ? 0.27 : 0.2;
  return clamp(likesPerMinute * share, 5, 90);
}

export function calculateSessionRosterSize(targetViewers: TargetViewers): number {
  return clamp(Math.round(20 + 6 * Math.sqrt(targetViewers)), 32, 240);
}

export function calculateActivePoolSize(currentViewers: number): number {
  return clamp(Math.round(3 + 2.2 * Math.sqrt(Math.max(0, currentViewers))), 4, 80);
}
