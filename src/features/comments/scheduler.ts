import { createPrng, type Prng } from '@/features/viewers/prng';
import { createId } from '@/shared/lib/ids';
import { getPersonaBadge } from '@/features/comments/presentation';
import { BEHAVIOR_CALIBRATION } from '@/features/comments/behavior';
import type { DialogueAction, DialogueReplyTarget } from '@/features/ai/contracts';
import type { AudiencePersona, LiveComment } from '@/shared/types/broadcast';

export const COMMENT_QUEUE_LIMIT = 100;
export const LOW_BUFFER_SECONDS = 30;
export type CommentEnqueueMode = 'append' | 'replace-context';
const MIN_EMIT_DELAY_MS = 520;
const MAX_EMIT_DELAY_MS = 180_000;
const RENDERED_TURN_TTL_MS = 180_000;

type ScheduleTimeout = (
  callback: () => void,
  delayMs: number,
) => ReturnType<typeof globalThis.setTimeout>;
type CancelTimeout = (timer: ReturnType<typeof globalThis.setTimeout>) => void;

export interface GeneratedAudienceComment {
  slotId: string;
  personaId: string;
  text: string;
  language: 'ru' | 'en';
  kind:
    | 'observation'
    | 'speech_reaction'
    | 'reaction'
    | 'question'
    | 'greeting'
    | 'casual'
    | 'viewer_reply';
  dialogueId?: string;
  dialogueAction?: DialogueAction;
  replyTarget?: DialogueReplyTarget;
}

export interface VisibilitySource {
  hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface CommentSchedulerOptions {
  seed: string | number;
  roster: AudiencePersona[];
  getCommentsPerMinute(): number;
  onComment(comment: LiveComment): void;
  onLowBuffer(): void;
  onBufferChanged?(remaining: number, rendered: boolean): void;
  onRendered?(comment: GeneratedAudienceComment): void;
  visibility?: VisibilitySource;
  now?: () => number;
  setTimer?: ScheduleTimeout;
  clearTimer?: CancelTimeout;
}

export class CommentScheduler {
  private readonly random: Prng;
  private readonly replyRandom: Prng;
  private readonly personas: Map<string, AudiencePersona>;
  private readonly visibility: VisibilitySource;
  private readonly now: () => number;
  private readonly setTimer: ScheduleTimeout;
  private readonly clearTimer: CancelTimeout;
  private readonly queue: GeneratedAudienceComment[] = [];
  private readonly renderedTurnAt = new Map<string, number>();
  private readonly viewerReplyReadyAt = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastEmittedAt = -Infinity;
  private dispersionMultiplier = 1;
  private dispersionUntil = -Infinity;
  private hostBurstAt = -Infinity;
  private sceneBurstAt = -Infinity;
  private priorityDelayPending = false;
  private wasLowBuffer = true;

  constructor(private readonly options: CommentSchedulerOptions) {
    this.random = createPrng(`${options.seed}:comments`);
    this.replyRandom = createPrng(`${options.seed}:conversation-replies`);
    this.personas = new Map();
    for (const persona of options.roster) this.personas.set(persona.id, persona);
    this.visibility = options.visibility ?? document;
    this.now = options.now ?? performance.now.bind(performance);
    this.setTimer =
      options.setTimer ?? ((callback, delay) => globalThis.setTimeout(callback, delay));
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
  }

  private readonly onVisibility = () => {
    if (this.visibility.hidden) {
      this.cancelTimer();
      return;
    }
    this.scheduleFresh();
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.visibility.addEventListener('visibilitychange', this.onVisibility);
    if (!this.visibility.hidden) this.scheduleFresh();
  }

  stop(): void {
    const wasRunning = this.running;
    this.running = false;
    this.clearPendingContext(false);
    if (wasRunning) this.visibility.removeEventListener('visibilitychange', this.onVisibility);
  }

  enqueue(comments: GeneratedAudienceComment[], mode: CommentEnqueueMode = 'append'): number {
    const replaceContext = mode === 'replace-context';
    if (replaceContext) this.clearPendingContext(false);
    const room = COMMENT_QUEUE_LIMIT - this.queue.length;
    const acceptedCount = Math.min(comments.length, Math.max(0, room));
    for (let index = 0; index < acceptedCount; index += 1) {
      const comment = comments[index];
      if (comment) this.queue.push(comment);
    }
    if (replaceContext && acceptedCount > 0) {
      this.hostBurstAt = this.now();
      this.priorityDelayPending = true;
    }
    if (this.bufferSeconds > LOW_BUFFER_SECONDS) this.wasLowBuffer = false;
    this.options.onBufferChanged?.(this.queue.length, false);
    if (this.running && !this.timer && !this.visibility.hidden) this.scheduleFresh();
    return acceptedCount;
  }

  resetTopic(): void {
    this.clearPendingContext(true);
  }

  private clearPendingContext(notify: boolean): void {
    this.cancelTimer();
    this.queue.length = 0;
    this.renderedTurnAt.clear();
    this.viewerReplyReadyAt.clear();
    this.priorityDelayPending = false;
    this.wasLowBuffer = true;
    if (notify) this.options.onBufferChanged?.(0, false);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private nextDelay(): number {
    const now = this.now();
    const calibration = BEHAVIOR_CALIBRATION.messageRate;
    if (now >= this.dispersionUntil) {
      this.dispersionMultiplier = Math.min(
        3,
        Math.max(0.25, this.sampleGamma(calibration.dispersionShape) / calibration.dispersionShape),
      );
      this.dispersionUntil = now + calibration.dispersionWindowMs;
    }
    const rate = Math.max(
      0.1,
      this.options.getCommentsPerMinute() * this.dispersionMultiplier * this.burstMultiplier(now),
    );
    const exponential = (-Math.log(Math.max(this.random.next(), 0.000_001)) * 60_000) / rate;
    return Math.min(MAX_EMIT_DELAY_MS, Math.max(MIN_EMIT_DELAY_MS, exponential));
  }

  private scheduleFresh(): void {
    this.cancelTimer();
    if (!this.running || this.visibility.hidden) return;
    const lowBuffer = this.bufferSeconds <= LOW_BUFFER_SECONDS;
    if (lowBuffer && !this.wasLowBuffer) this.options.onLowBuffer();
    this.wasLowBuffer = lowBuffer;
    if (this.queue.length === 0) return;
    const now = this.now();
    const eligibleIndex = this.findEligibleQueueIndex(now);
    if (this.queue.length === 0) return;
    const earliestReadyAt = eligibleIndex < 0 ? this.earliestReplyReadyAt(now) : null;
    if (eligibleIndex < 0 && earliestReadyAt === null) return;
    const delay =
      eligibleIndex >= 0
        ? this.priorityDelayPending
          ? this.random.range(...BEHAVIOR_CALIBRATION.hostBurst.firstResponseDelayMs)
          : this.nextDelay()
        : Math.min(MAX_EMIT_DELAY_MS, Math.max(MIN_EMIT_DELAY_MS, (earliestReadyAt ?? now) - now));
    this.priorityDelayPending = false;
    this.timer = this.setTimer(() => this.emit(), delay);
  }

  private emit(): void {
    this.timer = null;
    if (!this.running || this.visibility.hidden) return;
    const now = this.now();
    if (now - this.lastEmittedAt >= MIN_EMIT_DELAY_MS) {
      const eligibleIndex = this.findEligibleQueueIndex(now);
      const candidate = eligibleIndex >= 0 ? this.queue.splice(eligibleIndex, 1)[0] : undefined;
      const persona = candidate ? this.personas.get(candidate.personaId) : undefined;
      if (candidate && persona) {
        this.options.onComment({
          instanceId: createId('comment'),
          templateId: candidate.kind,
          author: persona.username,
          avatarSeed: persona.avatarSeed,
          text: candidate.text,
          badge: getPersonaBadge(this.options.seed, persona.avatarSeed),
          pinned: false,
          isHost: false,
          appearedAt: now,
        });
        this.lastEmittedAt = now;
        this.rememberRenderedTurn(candidate.slotId, now);
        this.options.onRendered?.(candidate);
        this.options.onBufferChanged?.(this.queue.length, true);
      }
    }
    this.scheduleFresh();
  }

  private findEligibleQueueIndex(now: number): number {
    this.pruneDialogueState(now);
    this.dropOrphanViewerReplies();
    return this.queue.findIndex((comment) => !this.isWaitingViewerReply(comment, now));
  }

  private earliestReplyReadyAt(now: number): number | null {
    let earliest = Infinity;
    for (const comment of this.queue) {
      if (!this.isWaitingViewerReply(comment, now)) continue;
      const readyAt = this.viewerReplyReadyAt.get(comment.slotId);
      if (readyAt !== undefined) earliest = Math.min(earliest, readyAt);
    }
    return Number.isFinite(earliest) ? earliest : null;
  }

  private isWaitingViewerReply(comment: GeneratedAudienceComment, now: number): boolean {
    const targetTurnId = this.viewerReplyTargetTurnId(comment);
    if (targetTurnId === null) return false;
    if (targetTurnId === undefined) return true;
    const renderedAt = this.renderedTurnAt.get(targetTurnId);
    if (renderedAt === undefined) return true;
    let readyAt = this.viewerReplyReadyAt.get(comment.slotId);
    if (readyAt === undefined) {
      readyAt =
        renderedAt + this.replyRandom.range(...BEHAVIOR_CALIBRATION.conversations.replyDelayMs);
      this.viewerReplyReadyAt.set(comment.slotId, readyAt);
    }
    return readyAt > now;
  }

  private viewerReplyTargetTurnId(comment: GeneratedAudienceComment): string | null | undefined {
    if (comment.dialogueAction !== 'reply_viewer') return null;
    return comment.replyTarget?.type === 'viewer' ? comment.replyTarget.turnId : undefined;
  }

  private rememberRenderedTurn(turnId: string, renderedAt: number): void {
    this.renderedTurnAt.delete(turnId);
    this.renderedTurnAt.set(turnId, renderedAt);
    while (this.renderedTurnAt.size > COMMENT_QUEUE_LIMIT) {
      const oldestTurnId = this.renderedTurnAt.keys().next().value as string | undefined;
      if (oldestTurnId === undefined) break;
      this.renderedTurnAt.delete(oldestTurnId);
    }
  }

  private dropOrphanViewerReplies(): void {
    if (this.queue.length === 0) return;
    const queuedByTurnId = new Map(this.queue.map((comment) => [comment.slotId, comment]));
    const validity = new Map<string, boolean>();
    const visiting = new Set<string>();

    const hasValidSource = (comment: GeneratedAudienceComment): boolean => {
      const cached = validity.get(comment.slotId);
      if (cached !== undefined) return cached;
      const targetTurnId = this.viewerReplyTargetTurnId(comment);
      if (targetTurnId === null) {
        validity.set(comment.slotId, true);
        return true;
      }
      if (targetTurnId === undefined) {
        validity.set(comment.slotId, false);
        return false;
      }
      if (this.renderedTurnAt.has(targetTurnId)) {
        validity.set(comment.slotId, true);
        return true;
      }
      if (visiting.has(comment.slotId)) {
        validity.set(comment.slotId, false);
        return false;
      }
      const queuedTarget = queuedByTurnId.get(targetTurnId);
      if (!queuedTarget) {
        validity.set(comment.slotId, false);
        return false;
      }
      visiting.add(comment.slotId);
      const valid = hasValidSource(queuedTarget);
      visiting.delete(comment.slotId);
      validity.set(comment.slotId, valid);
      return valid;
    };

    let removed = 0;
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const comment = this.queue[index];
      if (!comment || hasValidSource(comment)) continue;
      this.viewerReplyReadyAt.delete(comment.slotId);
      this.queue.splice(index, 1);
      removed += 1;
    }
    if (removed > 0) this.options.onBufferChanged?.(this.queue.length, false);
  }

  private pruneDialogueState(now: number): void {
    for (const [turnId, renderedAt] of this.renderedTurnAt)
      if (now - renderedAt > RENDERED_TURN_TTL_MS) this.renderedTurnAt.delete(turnId);

    const queuedTurnIds = new Set(this.queue.map(({ slotId }) => slotId));
    for (const [replyTurnId, readyAt] of this.viewerReplyReadyAt)
      if (!queuedTurnIds.has(replyTurnId) || now - readyAt > RENDERED_TURN_TTL_MS)
        this.viewerReplyReadyAt.delete(replyTurnId);
  }

  get queueSize(): number {
    return this.queue.length;
  }

  get bufferSeconds(): number {
    const rate = Math.max(0.1, this.options.getCommentsPerMinute());
    return (this.queue.length * 60) / rate;
  }

  signalSceneEvent(): void {
    this.sceneBurstAt = this.now();
  }

  private burstMultiplier(now: number): number {
    const decayed = (startedAt: number, initial: number, halfLifeMs: number) =>
      Number.isFinite(startedAt)
        ? 1 + (initial - 1) * 2 ** (-Math.max(0, now - startedAt) / halfLifeMs)
        : 1;
    const host = BEHAVIOR_CALIBRATION.hostBurst;
    const scene = BEHAVIOR_CALIBRATION.sceneBurst;
    return Math.min(
      host.maximumMultiplier,
      decayed(this.hostBurstAt, host.initialMultiplier, host.halfLifeMs) *
        decayed(this.sceneBurstAt, scene.initialMultiplier, scene.halfLifeMs),
    );
  }

  private sampleGamma(shape: number): number {
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const left = Math.max(Number.EPSILON, this.random.next());
      const right = Math.max(Number.EPSILON, this.random.next());
      const normal = Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
      const base = 1 + c * normal;
      if (base <= 0) continue;
      const value = base ** 3;
      const acceptance = this.random.next();
      if (
        acceptance < 1 - 0.0331 * normal ** 4 ||
        Math.log(acceptance) < 0.5 * normal ** 2 + d * (1 - value + Math.log(value))
      )
        return d * value;
    }
  }
}
