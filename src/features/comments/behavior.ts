import type { ActivityLevel } from '@/shared/types/broadcast';

export const BEHAVIOR_CALIBRATION = {
  messageRate: {
    messagesPerMinuteAt100Viewers: 6,
    viewerExponent: 0.55,
    minimum: 0.2,
    maximum: 42,
    activityMultiplier: { low: 0.65, normal: 1, high: 1.45 },
    dispersionShape: 2.25,
    dispersionWindowMs: 10_000,
  },
  load: { conversational: 8, overloaded: 40 },
  language: { russianShare: 0.88 },
  audience: { regularShare: 0.18, poolHysteresis: 0.15, rotationMs: 180_000 },
  style: {
    emojiShare: { conversational: 0.11, overloaded: 0.26 },
    typoShare: { minimum: 0.1, maximum: 0.15 },
    questionShare: { baseline: 0.075, invited: 0.16 },
    greetingShare: 0.1,
    reactionShare: 0.22,
    lowerCaseShare: 0.52,
    mixedCaseShare: 0.06,
    longShare: { conversational: 0.05, overloaded: 0.02 },
    shortShare: { conversational: 0.72, overloaded: 0.87 },
  },
  conversations: {
    messageShare: 0.011,
    maximumActive: 2,
    minimumTurns: 2,
    maximumTurns: 4,
    lifetimeMs: 45_000,
    continuationProbability: 0.65,
    replyDelayMs: [4_000, 12_000],
  },
  hostDialogues: {
    maximumActive: 3,
    maximumTurns: 6,
    lifetimeMs: 120_000,
    answerCount: [2, 3],
    invitedQuestionCount: [2, 3],
    continuationProbability: 0.35,
  },
  compliments: {
    messageShare: 0.015,
    cooldownMessages: 75,
  },
  authorCooldownMessages: 4,
  hostBurst: {
    firstResponseDelayMs: [1_500, 3_500],
    initialMultiplier: 2.4,
    halfLifeMs: 10_000,
    maximumMultiplier: 3.5,
  },
  sceneBurst: {
    initialMultiplier: 1.7,
    halfLifeMs: 8_000,
  },
} as const satisfies {
  messageRate: {
    messagesPerMinuteAt100Viewers: number;
    viewerExponent: number;
    minimum: number;
    maximum: number;
    activityMultiplier: Record<ActivityLevel, number>;
    dispersionShape: number;
    dispersionWindowMs: number;
  };
  load: { conversational: number; overloaded: number };
  language: { russianShare: number };
  audience: { regularShare: number; poolHysteresis: number; rotationMs: number };
  style: {
    emojiShare: { conversational: number; overloaded: number };
    typoShare: { minimum: number; maximum: number };
    questionShare: { baseline: number; invited: number };
    greetingShare: number;
    reactionShare: number;
    lowerCaseShare: number;
    mixedCaseShare: number;
    longShare: { conversational: number; overloaded: number };
    shortShare: { conversational: number; overloaded: number };
  };
  conversations: {
    messageShare: number;
    maximumActive: number;
    minimumTurns: number;
    maximumTurns: number;
    lifetimeMs: number;
    continuationProbability: number;
    replyDelayMs: readonly [number, number];
  };
  hostDialogues: {
    maximumActive: number;
    maximumTurns: number;
    lifetimeMs: number;
    answerCount: readonly [number, number];
    invitedQuestionCount: readonly [number, number];
    continuationProbability: number;
  };
  compliments: { messageShare: number; cooldownMessages: number };
  authorCooldownMessages: number;
  hostBurst: {
    firstResponseDelayMs: readonly [number, number];
    initialMultiplier: number;
    halfLifeMs: number;
    maximumMultiplier: number;
  };
  sceneBurst: { initialMultiplier: number; halfLifeMs: number };
};

export function smoothLoad(messagesPerMinute: number): number {
  const lower = BEHAVIOR_CALIBRATION.load.conversational;
  const upper = BEHAVIOR_CALIBRATION.load.overloaded;
  const normalized = Math.min(1, Math.max(0, (messagesPerMinute - lower) / (upper - lower)));
  return normalized * normalized * (3 - 2 * normalized);
}

export function interpolate(lower: number, upper: number, amount: number): number {
  return lower + (upper - lower) * Math.min(1, Math.max(0, amount));
}
