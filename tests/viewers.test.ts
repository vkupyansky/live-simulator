import { describe, expect, it } from 'vitest';
import { VIEWER_MAX_FACTOR, VIEWER_MIN_FACTOR, ViewerEngine } from '@/features/viewers/engine';
import { createPrng, seedToUint32 } from '@/features/viewers/prng';

describe('seedable viewer engine', () => {
  it('produces deterministic PRNG sequences for string and numeric seeds', () => {
    const left = createPrng('session-seed');
    const right = createPrng('session-seed');
    expect(Array.from({ length: 20 }, () => left.next())).toEqual(
      Array.from({ length: 20 }, () => right.next()),
    );
    expect(seedToUint32('session-seed')).toBe(seedToUint32('session-seed'));
  });

  it.each([7, 100, 7421, 999_999])('stays bounded and mean-reverts around %s', (target) => {
    const engine = new ViewerEngine({
      targetViewers: target,
      activity: 'normal',
      seed: 41,
      now: 0,
    });
    const values: number[] = [];
    for (let now = 1_000; now <= 35 * 60_000; now += 1_000)
      values.push(engine.tick(now).displayValue);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(Math.floor(target * VIEWER_MIN_FACTOR));
    expect(Math.max(...values)).toBeLessThanOrEqual(Math.ceil(target * VIEWER_MAX_FACTOR));
    const tail = values.slice(-600);
    const average = tail.reduce((sum, value) => sum + value, 0) / tail.length;
    expect(average).toBeGreaterThan(target * 0.88);
    expect(average).toBeLessThan(target * 1.12);
  });

  it('ramps toward the target and creates sustained surge/drop events', () => {
    const engine = new ViewerEngine({ targetViewers: 1000, activity: 'high', seed: 9281, now: 0 });
    const initial = engine.snapshot().value;
    let consecutiveEventTicks = 0;
    let longestEvent = 0;
    let afterRamp = 0;
    for (let now = 1_000; now <= 3 * 60 * 60_000; now += 1_000) {
      const state = engine.tick(now);
      if (now === 45_000) afterRamp = state.value;
      consecutiveEventTicks = state.event ? consecutiveEventTicks + 1 : 0;
      longestEvent = Math.max(longestEvent, consecutiveEventTicks);
    }
    expect(afterRamp).toBeGreaterThan(initial);
    expect(longestEvent).toBeGreaterThanOrEqual(14);
  });

  it('returns exactly the same states for the same seed and clock', () => {
    const input = { targetViewers: 2637, activity: 'low' as const, seed: 'same', now: 50 };
    const left = new ViewerEngine(input);
    const right = new ViewerEngine(input);
    for (let now = 1_050; now < 120_000; now += 1_000)
      expect(left.tick(now)).toEqual(right.tick(now));
  });

  it('models explicit arrivals and departures instead of changing the total directly', () => {
    const engine = new ViewerEngine({
      targetViewers: 12_345,
      activity: 'normal',
      seed: 'viewer-flow',
      now: 0,
    });
    let arrivalSeen = false;
    let departureSeen = false;
    for (let now = 1_000; now <= 180_000; now += 1_000) {
      const before = engine.snapshot().value;
      const state = engine.tick(now);
      expect(state.arrivals).toBeGreaterThanOrEqual(0);
      expect(state.departures).toBeGreaterThanOrEqual(0);
      expect(state.netChange).toBe(state.value - before);
      arrivalSeen ||= state.arrivals > 0;
      departureSeen ||= state.departures > 0;
    }
    expect(arrivalSeen).toBe(true);
    expect(departureSeen).toBe(true);
  });
});
