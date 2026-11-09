import { ACTIVITY_MULTIPLIER, clamp } from '@/features/audience/model';
import { samplePoisson } from '@/features/audience/stochastic';
import { createPrng, type Prng } from '@/features/viewers/prng';
import type { ActivityLevel, TargetViewers } from '@/shared/types/broadcast';

export const VIEWER_MIN_FACTOR = 0.82;
export const VIEWER_MAX_FACTOR = 1.18;
const START_MIN_FACTOR = 0.88;
const START_MAX_FACTOR = 0.96;
const RAMP_MIN_MS = 25_000;
const RAMP_MAX_MS = 55_000;
const EVENT_MIN_MS = 15_000;
const EVENT_MAX_MS = 40_000;
const EVENT_MIN_AMPLITUDE = 0.05;
const EVENT_MAX_AMPLITUDE = 0.12;
const VISIBLE_MIN_MS = 2_000;
const VISIBLE_MAX_MS = 4_000;
const TARGET_RESPONSE_SECONDS = 16;
const FLOW_NOISE_FACTOR = 0.14;
const MOMENTUM_DECAY = 0.72;
const DWELL_SECONDS: Record<ActivityLevel, number> = {
  low: 82,
  normal: 112,
  high: 148,
};

export interface ViewerEngineInput {
  targetViewers: TargetViewers;
  activity: ActivityLevel;
  seed: string | number;
  now: number;
}

export interface ViewerState {
  value: number;
  displayValue: number;
  arrivals: number;
  departures: number;
  netChange: number;
  momentum: number;
  smoothedNoise: number;
  elapsedMs: number;
  event: 'surge' | 'drop' | null;
  eventFactor: number;
  nextVisibleAt: number;
}

interface ViewerEvent {
  kind: 'surge' | 'drop';
  startedAt: number;
  endsAt: number;
  amplitude: number;
}

export class ViewerEngine {
  private readonly random: Prng;
  private readonly startedAt: number;
  private readonly rampDurationMs: number;
  private readonly initialFactor: number;
  private lastAt: number;
  private event: ViewerEvent | null = null;
  private state: ViewerState;

  constructor(private readonly input: ViewerEngineInput) {
    this.random = createPrng(input.seed);
    this.startedAt = input.now;
    this.lastAt = input.now;
    this.rampDurationMs = this.random.range(RAMP_MIN_MS, RAMP_MAX_MS);
    this.initialFactor = this.random.range(START_MIN_FACTOR, START_MAX_FACTOR);
    const initial = Math.max(0, Math.round(input.targetViewers * this.initialFactor));
    this.state = {
      value: initial,
      displayValue: initial,
      arrivals: 0,
      departures: 0,
      netChange: 0,
      momentum: 0,
      smoothedNoise: 0,
      elapsedMs: 0,
      event: null,
      eventFactor: 0,
      nextVisibleAt: input.now + this.random.range(VISIBLE_MIN_MS, VISIBLE_MAX_MS),
    };
  }

  tick(now: number): ViewerState {
    const elapsedSeconds = clamp((now - this.lastAt) / 1000, 0.25, 3);
    this.lastAt = now;
    const elapsedMs = Math.max(0, now - this.startedAt);
    const activityMultiplier = ACTIVITY_MULTIPLIER[this.input.activity];
    if (!this.event && elapsedMs > 12_000) {
      const eventChance = (activityMultiplier * elapsedSeconds) / 165;
      if (this.random.next() < eventChance) {
        const duration = this.random.range(EVENT_MIN_MS, EVENT_MAX_MS);
        this.event = {
          kind: this.random.next() < 0.62 ? 'surge' : 'drop',
          startedAt: now,
          endsAt: now + duration,
          amplitude: this.random.range(EVENT_MIN_AMPLITUDE, EVENT_MAX_AMPLITUDE),
        };
      }
    }

    let eventFactor = 0;
    if (this.event) {
      const progress = (now - this.event.startedAt) / (this.event.endsAt - this.event.startedAt);
      if (progress >= 1) this.event = null;
      else {
        const envelope = Math.sin(Math.PI * clamp(progress, 0, 1));
        eventFactor = this.event.amplitude * envelope * (this.event.kind === 'surge' ? 1 : -1);
      }
    }

    const rampProgress = clamp(elapsedMs / this.rampDurationMs, 0, 1);
    const rampFactor = this.initialFactor + (1 - this.initialFactor) * rampProgress;
    const desired = this.input.targetViewers * (rampFactor + eventFactor);
    const rawNoise = this.random.range(-1, 1);
    const smoothedNoise = this.state.smoothedNoise * 0.82 + rawNoise * 0.18;
    const flowNoise =
      smoothedNoise *
      Math.sqrt(Math.max(1, this.input.targetViewers)) *
      FLOW_NOISE_FACTOR *
      activityMultiplier;
    const targetFlow = ((desired - this.state.value) / TARGET_RESPONSE_SECONDS) * elapsedSeconds;
    const churn =
      (Math.max(0, this.state.value) / DWELL_SECONDS[this.input.activity]) * elapsedSeconds;
    const arrivals = samplePoisson(this.random, churn + Math.max(0, targetFlow + flowNoise));
    const sampledDepartures = samplePoisson(
      this.random,
      churn + Math.max(0, -targetFlow - flowNoise),
    );
    const departures = Math.min(this.state.value, sampledDepartures);
    const netChange = arrivals - departures;
    const minimum = Math.max(0, Math.floor(this.input.targetViewers * VIEWER_MIN_FACTOR));
    const maximum = Math.max(minimum + 1, Math.ceil(this.input.targetViewers * VIEWER_MAX_FACTOR));
    const value = Math.round(clamp(this.state.value + netChange, minimum, maximum));
    const visible = now >= this.state.nextVisibleAt;
    const displayValue = visible
      ? Math.round(this.state.displayValue + (value - this.state.displayValue) * 0.72)
      : this.state.displayValue;
    const momentum = this.state.momentum * MOMENTUM_DECAY + netChange * (1 - MOMENTUM_DECAY);
    this.state = {
      value,
      displayValue: Math.round(clamp(displayValue, minimum, maximum)),
      arrivals,
      departures,
      netChange: value - this.state.value,
      momentum,
      smoothedNoise,
      elapsedMs,
      event: this.event?.kind ?? null,
      eventFactor,
      nextVisibleAt: visible
        ? now + this.random.range(VISIBLE_MIN_MS, VISIBLE_MAX_MS)
        : this.state.nextVisibleAt,
    };
    return { ...this.state };
  }

  snapshot(): ViewerState {
    return { ...this.state };
  }
}
