import { describe, expect, it } from 'vitest';
import { LikeEngine, likesPerMinute } from '@/features/likes/engine';
import { reactionIntensity } from '@/features/reactions/engine';

describe('automatic engagement engines', () => {
  it('scales likes across audience sizes and activity levels', () => {
    expect(likesPerMinute(7, 'normal')).toBeLessThan(likesPerMinute(100, 'normal'));
    expect(likesPerMinute(100, 'normal')).toBeLessThan(likesPerMinute(500, 'normal'));
    expect(likesPerMinute(500, 'normal')).toBeLessThan(likesPerMinute(7421, 'normal'));
    expect(likesPerMinute(7421, 'normal')).toBeLessThan(likesPerMinute(999_999, 'normal'));
    expect(likesPerMinute(500, 'low')).toBeLessThan(likesPerMinute(500, 'high'));
  });

  it.each([7, 500, 7421, 999_999])(
    'keeps likes monotonic for %s viewers and emits bursts',
    (viewers) => {
      const engine = new LikeEngine('high', `likes-${viewers}`, 0, viewers);
      let previous = engine.snapshot();
      let burstSeen = false;
      for (let now = 500; now < 20 * 60_000; now += 500) {
        const state = engine.tick({
          now,
          currentViewers: viewers,
          viewerEventFactor: now > 40_000 && now < 80_000 ? 0.1 : 0,
          commentsPerMinute: 18,
        });
        expect(state.value).toBeGreaterThanOrEqual(previous);
        burstSeen ||= state.burst;
        previous = state.value;
      }
      expect(burstSeen).toBe(true);
    },
  );

  it('raises reaction intensity for surge, chat and like burst', () => {
    const calm = reactionIntensity({
      currentViewers: 500,
      activity: 'low',
      viewerEventFactor: 0,
      commentsPerMinute: 5,
      likeBurst: false,
    });
    const active = reactionIntensity({
      currentViewers: 500,
      activity: 'high',
      viewerEventFactor: 0.1,
      commentsPerMinute: 20,
      likeBurst: true,
    });
    expect(active).toBeGreaterThan(calm);
    expect(active).toBeLessThanOrEqual(10);
  });
});
