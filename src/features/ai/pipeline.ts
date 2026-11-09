import { clamp } from '@/features/audience/model';
import { analyzeContext, ApiRequestError, generateComments } from '@/features/ai/apiClient';
import {
  EMPTY_SEMANTIC_CONTEXT,
  type CommentGenerationRequest,
  type ContextAnalysisRequest,
  type SemanticContext,
} from '@/features/ai/contracts';
import type { ConversationDirector } from '@/features/comments/director';
import { analyzeHostUtterance } from '@/features/comments/hostUtterance';
import { LOW_BUFFER_SECONDS, type CommentScheduler } from '@/features/comments/scheduler';
import type { CommentPipelineStatus } from '@/features/session/store';
import { seedToUint32 } from '@/features/viewers/prng';
import { FORCE_FRAME_INTERVAL_MS, captureVideoFrame, runWhenIdle } from '@/features/vision/frame';
import { createId } from '@/shared/lib/ids';
import { logger } from '@/shared/lib/logger';
import type {
  AudiencePersona,
  LiveComment,
  RuntimeBroadcast,
  TranscriptSegment,
} from '@/shared/types/broadcast';

const MIN_COMMENT_REQUEST_INTERVAL_MS = 3_500;
const MIN_TRANSCRIPT_REACTION_INTERVAL_MS = 6_000;
export const COMMENT_BACKOFF_BASE_MS = 8_000;
const COMMENT_BACKOFF_MAX_MS = 60_000;
const COMMENT_PIPELINE_WATCHDOG_MS = 4_000;
const TARGET_BUFFER_SECONDS = 70;
const CONTEXT_RETRY_INTERVAL_MS = 12_000;

interface CommentPipelineDiagnostic {
  requestId?: string;
  sessionIdHash: string;
  sequence: number;
  state: string;
  requestedBatchSize: number;
  receivedItems: number;
  acceptedItems: number;
  bufferedItems: number;
  scheduledItems: number;
  renderedItems: number;
  inFlight: boolean;
  retryAt?: number;
  issueCodes: string[];
}

interface AiCommentPipelineOptions {
  broadcast: RuntimeBroadcast;
  roster: AudiencePersona[];
  scheduler: CommentScheduler;
  director: ConversationDirector;
  signal: AbortSignal;
  getViewers(): number;
  getCommentsPerMinute(): number;
  getRecentComments(): LiveComment[];
  getTranscript(): TranscriptSegment[];
  isCurrent(): boolean;
  onStatus(status: CommentPipelineStatus): void;
  now?: () => number;
}

type PauseReason = 'hidden' | 'offline';

function transcriptSequencesAfter(
  segments: readonly TranscriptSegment[],
  boundarySequence: number,
): number[] {
  return segments
    .filter((segment) => segment.sequence > boundarySequence)
    .map((segment) => segment.sequence);
}

function consumeOneShotContext(context: SemanticContext): SemanticContext {
  if (context.hostIntent !== 'request_questions' && context.hostIntent !== 'request_topics')
    return context;
  return {
    ...context,
    conversationSummary: '',
    topic: '',
    hostIntent: 'ambient',
    hostTarget: { ...EMPTY_SEMANTIC_CONTEXT.hostTarget },
    audienceDirection: {
      ...context.audienceDirection,
      reactToSpeech: false,
      suggestedTopics: [],
      keyFacts: [],
    },
  };
}

export class AiCommentPipeline {
  private readonly now: () => number;
  private readonly personaByAvatar: ReadonlyMap<string, string>;
  private readonly pausedReasons = new Set<PauseReason>();
  private video: HTMLVideoElement | null = null;
  private requestInFlight = false;
  private started = false;
  private stopped = false;
  private terminalFailure = false;
  private firstRequestPending = true;
  private sequence = 0;
  private lastRequestAt = -Infinity;
  private lastFrameAt = -Infinity;
  private lastContextAttemptAt = -Infinity;
  private signature: Uint8Array | null = null;
  private semanticContext: SemanticContext = EMPTY_SEMANTIC_CONTEXT;
  private semanticContextRevision = 0;
  private hasValidContext = false;
  private lastContextAnalyzedTranscriptSequence = 0;
  private lastContextAttemptedTranscriptSequence = 0;
  private lastGeneratedTranscriptSequence = 0;
  private lastTopicResetSequence = 0;
  private topicEpochStartedAt = -Infinity;
  private generationToken = 0;
  private requestAbortController: AbortController | null = null;
  private consecutiveFailures = 0;
  private backoffUntil = -Infinity;
  private deferredTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private watchdogTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  private renderedItems = 0;
  private requestedBatchSize = 0;

  constructor(private readonly options: AiCommentPipelineOptions) {
    this.now = options.now ?? performance.now.bind(performance);
    this.personaByAvatar = new Map(
      options.roster.map((persona) => [persona.avatarSeed, persona.id]),
    );
  }

  private readonly onVideoReady = () => this.requestSoon();
  private readonly onVisibility = () => {
    if (document.hidden) this.pause('hidden');
    else this.resume('hidden');
  };
  private readonly onPageHide = () => this.pause('hidden');
  private readonly onPageShow = () => this.resume('hidden');
  private readonly onFreeze = () => this.pause('hidden');
  private readonly onResume = () => this.resume('hidden');
  private readonly onOffline = () => this.pause('offline');
  private readonly onOnline = () => this.resume('offline');

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onPageHide);
    window.addEventListener('pageshow', this.onPageShow);
    document.addEventListener('freeze', this.onFreeze);
    document.addEventListener('resume', this.onResume);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
    if (document.hidden) this.pausedReasons.add('hidden');
    if (!navigator.onLine) this.pausedReasons.add('offline');
    if (this.pausedReasons.size > 0) {
      this.publishPaused();
      return;
    }
    this.armWatchdog();
    this.requestSoon();
  }

  private armWatchdog(): void {
    if (!this.started || this.watchdogTimer || this.stopped || this.pausedReasons.size > 0) return;
    this.watchdogTimer = globalThis.setInterval(
      () => this.watchdog(),
      COMMENT_PIPELINE_WATCHDOG_MS,
    );
  }

  private clearWatchdog(): void {
    if (this.watchdogTimer) globalThis.clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
  }

  attachVideo(video: HTMLVideoElement): void {
    if (this.stopped) return;
    if (this.video && this.video !== video) this.removeVideoReadyListeners();
    this.video = video;
    this.armVideoReadyListeners();
    if (this.started) this.requestSoon();
  }

  transcriptChanged(): void {
    this.applyDetectedTopicReset(this.options.getTranscript(), this.now());
    this.requestSoon();
  }

  private applyDetectedTopicReset(
    transcriptSegments: readonly TranscriptSegment[],
    now: number,
  ): boolean {
    const unhandledSegments = transcriptSegments.filter(
      ({ sequence }) => sequence > this.lastTopicResetSequence,
    );
    const latest = unhandledSegments.at(-1);
    if (
      !latest ||
      !analyzeHostUtterance(unhandledSegments.map(({ text }) => text).join(' ')).resetsTopic
    )
      return false;

    this.lastTopicResetSequence = latest.sequence;
    this.topicEpochStartedAt = now;
    this.generationToken += 1;
    this.requestAbortController?.abort('topic-reset');
    this.options.scheduler.resetTopic();
    this.options.director.resetTopic(latest.sequence);
    this.semanticContext = {
      ...this.semanticContext,
      sceneSummary: '',
      conversationSummary: '',
      topic: '',
      topicResetSequence: latest.sequence,
      hostIntent: 'request_topics',
      hostTarget: {
        type: 'none',
        transcriptSequence: 0,
        dialogueId: '',
        turnId: '',
        personaId: '',
      },
      presenterContext: {
        ...this.semanticContext.presenterContext,
        complimentTargetId: 'none',
        complimentCue: '',
      },
      visualGrounding: { ...EMPTY_SEMANTIC_CONTEXT.visualGrounding },
      audienceDirection: {
        ...this.semanticContext.audienceDirection,
        reactToSpeech: true,
        keyFacts: [],
      },
    };
    return true;
  }

  private clearVolatileSemanticContext(): void {
    this.semanticContext = {
      ...EMPTY_SEMANTIC_CONTEXT,
      topicResetSequence: this.semanticContext.topicResetSequence,
      presenterContext: {
        ...EMPTY_SEMANTIC_CONTEXT.presenterContext,
        participants: [
          {
            id: 'primary',
            label: this.options.broadcast.displayName,
            labelSource: 'configured',
            visible: false,
            visualAnchor: '',
          },
        ],
      },
    };
  }

  private hasPendingTranscript(): boolean {
    return this.options
      .getTranscript()
      .some((segment) => segment.sequence > this.lastGeneratedTranscriptSequence);
  }

  private minimumRequestInterval(): number {
    return this.hasPendingTranscript()
      ? MIN_TRANSCRIPT_REACTION_INTERVAL_MS
      : MIN_COMMENT_REQUEST_INTERVAL_MS;
  }

  bufferChanged(remaining: number, rendered: boolean): void {
    if (rendered) this.renderedItems += 1;
    if (this.requestInFlight || this.pausedReasons.size > 0 || this.stopped || this.terminalFailure)
      return;
    this.options.onStatus(
      rendered ? { state: 'active', remaining } : { state: 'buffered', remaining },
    );
    if (this.options.scheduler.bufferSeconds <= LOW_BUFFER_SECONDS) this.requestSoon();
  }

  requestSoon(): void {
    if (
      !this.started ||
      this.stopped ||
      this.terminalFailure ||
      this.pausedReasons.size > 0 ||
      this.requestInFlight ||
      this.options.signal.aborted ||
      !this.options.isCurrent()
    )
      return;
    if (this.firstRequestPending && !this.video) return;
    const now = this.now();
    const intervalWait = this.firstRequestPending
      ? 0
      : this.lastRequestAt + this.minimumRequestInterval() - now;
    const wait = Math.max(0, intervalWait, this.backoffUntil - now);
    if (this.deferredTimer) globalThis.clearTimeout(this.deferredTimer);
    this.deferredTimer = globalThis.setTimeout(() => {
      this.deferredTimer = null;
      void this.request();
    }, wait);
  }

  private async request(): Promise<void> {
    if (
      this.stopped ||
      this.terminalFailure ||
      this.requestInFlight ||
      this.pausedReasons.size > 0 ||
      this.options.signal.aborted ||
      !this.options.isCurrent()
    )
      return;
    const now = this.now();
    if (now < this.backoffUntil) {
      this.requestSoon();
      return;
    }
    if (!this.firstRequestPending && now - this.lastRequestAt < this.minimumRequestInterval()) {
      this.requestSoon();
      return;
    }

    const transcriptSegments = this.options.getTranscript();
    this.applyDetectedTopicReset(transcriptSegments, now);
    const newCommentTranscriptSequences = transcriptSequencesAfter(
      transcriptSegments,
      this.lastGeneratedTranscriptSequence,
    );
    const transcriptChanged = newCommentTranscriptSequences.length > 0;
    const newContextTranscriptSequences = transcriptSequencesAfter(
      transcriptSegments,
      this.lastContextAnalyzedTranscriptSequence,
    );
    const contextTranscriptChanged = newContextTranscriptSequences.length > 0;
    const newestContextSequence = newContextTranscriptSequences.at(-1) ?? 0;
    const currentContextUtterance = transcriptSegments
      .filter(({ sequence }) => newContextTranscriptSequences.includes(sequence))
      .map(({ text }) => text)
      .join(' ');
    const utteranceAnalysis = analyzeHostUtterance(currentContextUtterance);

    this.requestInFlight = true;
    const generationToken = this.generationToken;
    const requestController = new AbortController();
    const abortForSession = () => requestController.abort('session-ended');
    if (this.options.signal.aborted) abortForSession();
    else this.options.signal.addEventListener('abort', abortForSession, { once: true });
    this.requestAbortController = requestController;

    try {
      const forceFrame =
        !this.hasValidContext ||
        utteranceAnalysis.referencesCurrentFrame ||
        now - this.lastFrameAt >= FORCE_FRAME_INTERVAL_MS;
      const frame = this.video
        ? await runWhenIdle(
            () => captureVideoFrame(this.video as HTMLVideoElement, this.signature, forceFrame),
            requestController.signal,
          )
        : null;
      if (this.firstRequestPending && !frame?.dataUrl) {
        this.armVideoReadyListeners();
        return;
      }
      if (frame) {
        this.signature = frame.signature;
        if (frame.dataUrl) this.lastFrameAt = now;
        if (frame.sceneChanged && !this.firstRequestPending)
          this.options.scheduler.signalSceneEvent();
      }

      const sequence = ++this.sequence;
      const currentViewers = this.options.getViewers();
      const commentsPerMinute = this.options.getCommentsPerMinute();
      const targetQueueSize = clamp(
        Math.ceil((commentsPerMinute * TARGET_BUFFER_SECONDS) / 60),
        4,
        24,
      );
      const deficit = Math.max(1, targetQueueSize - this.options.scheduler.queueSize);
      const desiredBatchSize = clamp(transcriptChanged ? Math.max(4, deficit) : deficit, 1, 24);
      this.requestedBatchSize = desiredBatchSize;
      const hasUnattemptedContextTranscript =
        contextTranscriptChanged &&
        newestContextSequence > this.lastContextAttemptedTranscriptSequence;
      const recentComments = this.options
        .getRecentComments()
        .filter(({ appearedAt }) => appearedAt >= this.topicEpochStartedAt)
        .slice(-30);
      const recentCommentContext = recentComments.map((comment) => ({
        personaId: this.personaByAvatar.get(comment.avatarSeed) ?? comment.avatarSeed,
        text: comment.text,
      }));
      const openDialogues = this.options.director.getOpenDialogues(now);

      const shouldAnalyzeContext =
        !this.hasValidContext ||
        Boolean(frame?.sceneChanged) ||
        contextTranscriptChanged ||
        now - this.lastContextAttemptAt >= FORCE_FRAME_INTERVAL_MS;
      if (
        shouldAnalyzeContext &&
        (hasUnattemptedContextTranscript ||
          now - this.lastContextAttemptAt >= CONTEXT_RETRY_INTERVAL_MS)
      ) {
        this.lastContextAttemptAt = now;
        this.lastContextAttemptedTranscriptSequence = Math.max(
          this.lastContextAttemptedTranscriptSequence,
          newestContextSequence,
        );
        const contextRequest: ContextAnalysisRequest = {
          sessionId: this.options.broadcast.sessionId,
          sequence,
          currentViewers,
          targetViewers: this.options.broadcast.targetViewers,
          activity: this.options.broadcast.activity,
          host: {
            displayName: this.options.broadcast.displayName,
            username: this.options.broadcast.username,
          },
          transcriptSegments,
          newTranscriptSequences: newContextTranscriptSequences,
          recentComments: recentCommentContext,
          openDialogues,
          previousContext: this.semanticContext,
          sceneChanged: frame?.sceneChanged ?? false,
          transcriptChanged: contextTranscriptChanged,
          ...(frame?.dataUrl
            ? {
                frameDataUrl: frame.dataUrl,
                frameMetadata: {
                  width: frame.width,
                  height: frame.height,
                  byteLength: frame.size,
                  ...frame.quality,
                },
              }
            : {}),
        };
        try {
          this.semanticContext = await analyzeContext(
            contextRequest,
            createId(`context_${contextRequest.sessionId}_${sequence}`),
            requestController.signal,
          );
          this.semanticContextRevision += 1;
          this.lastContextAnalyzedTranscriptSequence = Math.max(
            this.lastContextAnalyzedTranscriptSequence,
            newestContextSequence,
          );
          this.hasValidContext = true;
        } catch (error) {
          if (requestController.signal.aborted) throw error;
          this.clearVolatileSemanticContext();
          const code = error instanceof ApiRequestError ? error.code : 'NETWORK_ERROR';
          logger.warn('context_pipeline_cleared_volatile_context', code, {
            sessionIdHash: seedToUint32(this.options.broadcast.sessionId).toString(16),
            sequence,
            hasPreviousContext: this.hasValidContext,
          });
        }
      }

      const directorPlan = this.options.director.plan({
        sequence,
        desiredBatchSize,
        currentViewers,
        commentsPerMinute,
        transcriptSegments,
        newTranscriptSequences: newCommentTranscriptSequences,
        transcriptChanged,
        semanticContext: this.semanticContext,
        semanticContextRevision: this.semanticContextRevision,
        now,
      });
      if (directorPlan.slots.length === 0)
        throw new ApiRequestError(
          'Не удалось подготовить пакет комментариев.',
          500,
          true,
          0,
          'AI_RESPONSE_INVALID',
        );
      const request: CommentGenerationRequest = {
        sessionId: this.options.broadcast.sessionId,
        sequence,
        currentViewers,
        targetViewers: this.options.broadcast.targetViewers,
        activity: this.options.broadcast.activity,
        host: {
          displayName: this.options.broadcast.displayName,
          username: this.options.broadcast.username,
        },
        personas: directorPlan.personas,
        slots: directorPlan.slots,
        recentComments: recentCommentContext,
        noveltyTexts: directorPlan.noveltyTexts,
        personaMemories: directorPlan.memories,
        openDialogues: directorPlan.openDialogues,
        transcriptSegments,
        semanticContext: directorPlan.semanticContext,
      };
      this.lastRequestAt = now;
      this.options.onStatus({ state: 'requesting', sequence });
      const response = await generateComments(
        request,
        createId(`comments_${request.sessionId}_${sequence}`),
        requestController.signal,
      );
      if (
        !this.options.isCurrent() ||
        this.stopped ||
        sequence !== this.sequence ||
        generationToken !== this.generationToken
      )
        return;

      this.consecutiveFailures = 0;
      this.backoffUntil = -Infinity;
      this.firstRequestPending = false;
      this.removeVideoReadyListeners();
      const accepted = this.options.scheduler.enqueue(
        response.comments,
        transcriptChanged ? 'replace-context' : 'append',
      );
      this.options.director.recordBatch(sequence, response.comments.slice(0, accepted));
      this.options.onStatus({ state: 'buffered', remaining: this.options.scheduler.queueSize });
      if (accepted === 0)
        throw new ApiRequestError('Пустой runtime batch.', 502, true, 0, 'AI_RESPONSE_INVALID');
      this.semanticContext = consumeOneShotContext(directorPlan.semanticContext);
      this.lastGeneratedTranscriptSequence = Math.max(
        this.lastGeneratedTranscriptSequence,
        newCommentTranscriptSequences.at(-1) ?? 0,
      );
    } catch (error) {
      const staleGeneration = generationToken !== this.generationToken;
      if (!staleGeneration && !this.options.signal.aborted && !this.stopped)
        this.handleFailure(error);
    } finally {
      this.options.signal.removeEventListener('abort', abortForSession);
      if (this.requestAbortController === requestController) this.requestAbortController = null;
      this.requestInFlight = false;
      if (
        (this.consecutiveFailures > 0 ||
          this.hasPendingTranscript() ||
          this.options.scheduler.bufferSeconds <= LOW_BUFFER_SECONDS) &&
        !this.stopped &&
        !this.options.signal.aborted
      )
        this.requestSoon();
    }
  }

  private handleFailure(error: unknown): void {
    const code = error instanceof ApiRequestError ? error.code : 'NETWORK_ERROR';
    const retryable = !(error instanceof ApiRequestError) || error.retryable;
    this.options.director.recordFailure(this.sequence);
    if (!retryable) {
      this.terminalFailure = true;
      if (this.deferredTimer) globalThis.clearTimeout(this.deferredTimer);
      this.deferredTimer = null;
      this.options.onStatus({ state: 'error', retryable: false, code });
      logger.warn('comment_pipeline_failed', code, { ...this.diagnostic([code]) });
      return;
    }
    this.consecutiveFailures += 1;
    const calculatedBackoff = Math.min(
      COMMENT_BACKOFF_MAX_MS,
      COMMENT_BACKOFF_BASE_MS * 2 ** (this.consecutiveFailures - 1),
    );
    const apiBackoff = error instanceof ApiRequestError ? error.retryAfterMs : 0;
    this.backoffUntil = this.now() + Math.max(calculatedBackoff, apiBackoff);
    this.options.onStatus({ state: 'backoff', retryAt: this.backoffUntil, reason: code });
    logger.warn('comment_pipeline_backoff', code, { ...this.diagnostic([code]) });
  }

  private watchdog(): void {
    if (
      this.stopped ||
      !this.started ||
      this.terminalFailure ||
      this.requestInFlight ||
      this.pausedReasons.size > 0 ||
      this.options.signal.aborted ||
      !this.options.isCurrent() ||
      this.deferredTimer
    )
      return;
    if (this.firstRequestPending || this.options.scheduler.bufferSeconds <= LOW_BUFFER_SECONDS)
      this.requestSoon();
  }

  pause(reason: PauseReason): void {
    if (this.stopped) return;
    const wasActive = this.pausedReasons.size === 0;
    this.pausedReasons.add(reason);
    if (this.deferredTimer) globalThis.clearTimeout(this.deferredTimer);
    this.deferredTimer = null;
    if (wasActive) {
      this.clearWatchdog();
      this.generationToken += 1;
      this.options.director.recordFailure(this.sequence);
      this.requestAbortController?.abort('pipeline-paused');
    }
    this.publishPaused();
  }

  resume(reason: PauseReason): void {
    if (this.stopped) return;
    this.pausedReasons.delete(reason);
    if (this.pausedReasons.size > 0) {
      this.publishPaused();
      return;
    }
    this.armWatchdog();
    this.bufferChanged(this.options.scheduler.queueSize, this.renderedItems > 0);
    this.requestSoon();
  }

  private publishPaused(): void {
    const reason = this.pausedReasons.has('hidden') ? 'hidden' : 'offline';
    this.options.onStatus({ state: 'paused', reason });
  }

  private armVideoReadyListeners(): void {
    if (!this.video || !this.firstRequestPending) return;
    this.video.addEventListener('loadeddata', this.onVideoReady, { once: true });
    this.video.addEventListener('canplay', this.onVideoReady, { once: true });
  }

  private removeVideoReadyListeners(): void {
    this.video?.removeEventListener('loadeddata', this.onVideoReady);
    this.video?.removeEventListener('canplay', this.onVideoReady);
  }

  private diagnostic(issueCodes: string[]): CommentPipelineDiagnostic {
    return {
      sessionIdHash: seedToUint32(this.options.broadcast.sessionId).toString(16),
      sequence: this.sequence,
      state:
        this.pausedReasons.size > 0 ? 'paused' : this.requestInFlight ? 'requesting' : 'active',
      requestedBatchSize: this.requestedBatchSize,
      receivedItems: 0,
      acceptedItems: 0,
      bufferedItems: this.options.scheduler.queueSize,
      scheduledItems: this.options.scheduler.queueSize,
      renderedItems: this.renderedItems,
      inFlight: this.requestInFlight,
      ...(Number.isFinite(this.backoffUntil) ? { retryAt: this.backoffUntil } : {}),
      issueCodes,
    };
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.generationToken += 1;
    this.requestAbortController?.abort('session-ended');
    this.requestAbortController = null;
    this.started = false;
    if (this.deferredTimer) globalThis.clearTimeout(this.deferredTimer);
    this.clearWatchdog();
    this.deferredTimer = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('pageshow', this.onPageShow);
    document.removeEventListener('freeze', this.onFreeze);
    document.removeEventListener('resume', this.onResume);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
    this.removeVideoReadyListeners();
    this.options.director.stop();
    this.video = null;
    this.signature = null;
    this.semanticContextRevision = 0;
    this.lastTopicResetSequence = 0;
    this.topicEpochStartedAt = -Infinity;
  }
}
