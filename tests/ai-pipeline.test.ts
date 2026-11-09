import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiCommentPipeline, COMMENT_BACKOFF_BASE_MS } from '@/features/ai/pipeline';
import {
  EMPTY_SEMANTIC_CONTEXT,
  type CommentGenerationRequest,
  type ContextAnalysisRequest,
  type SemanticContext,
} from '@/features/ai/contracts';
import { ConversationDirector } from '@/features/comments/director';
import type { CommentScheduler, GeneratedAudienceComment } from '@/features/comments/scheduler';
import { useSessionStore } from '@/features/session/store';
import type { AudiencePersona, RuntimeBroadcast } from '@/shared/types/broadcast';

vi.mock('@/features/vision/frame', () => ({
  FORCE_FRAME_INTERVAL_MS: 50_000,
  captureVideoFrame: vi.fn(async () => ({
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    size: 8,
    width: 430,
    height: 932,
    signature: new Uint8Array([1]),
    sceneChanged: true,
    quality: {
      meanLuminance: 0.42,
      luminanceDeviation: 0.18,
      darkPixelRatio: 0.21,
      clippedBlackRatio: 0.03,
    },
  })),
  runWhenIdle: vi.fn(async (operation: () => Promise<unknown>) => await operation()),
}));

const broadcast: RuntimeBroadcast = {
  sessionId: 'session_pipeline_test',
  seed: 42,
  displayName: 'Host',
  username: 'host.live',
  avatarDataUrl: 'data:image/png;base64,AA==',
  media: { kind: 'camera' },
  targetViewers: 500,
  activity: 'normal',
  speechAnalysisEnabled: true,
};

const roster: AudiencePersona[] = [
  {
    id: 'persona_1',
    username: 'mira.wave',
    displayName: 'Mira',
    avatarSeed: 'mira',
    primaryLanguage: 'ru',
    style: {
      casing: 'lower',
      language: 'ru',
      tone: 'short',
      typoProbability: 0.08,
      emojiProbability: 0.12,
      activityWeight: 1,
    },
  },
];

const semanticContext: SemanticContext = {
  sceneSummary: 'ведущий находится в комнате',
  conversationSummary: 'обсуждают путешествия',
  topic: 'путешествия',
  topicResetSequence: 0,
  hostIntent: 'request_questions',
  hostTarget: {
    type: 'audience',
    transcriptSequence: 1,
    dialogueId: '',
    turnId: '',
    personaId: '',
  },
  presenterContext: {
    visibleCount: 1,
    participants: [
      {
        id: 'primary',
        label: 'Host',
        labelSource: 'configured',
        visible: true,
        visualAnchor: 'ведущий в центре кадра',
      },
    ],
    event: 'none',
    eventParticipantId: 'none',
    eventCue: '',
    complimentTargetId: 'none',
    complimentCue: '',
  },
  visualGrounding: {
    status: 'none',
    label: '',
    transcriptSequence: 0,
    frameSequence: 0,
  },
  audienceDirection: {
    reactToSpeech: true,
    questionShare: 0.25,
    suggestedTopics: ['любимые города'],
    keyFacts: ['ведущий планирует поездку'],
  },
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function generatedBatch(request: CommentGenerationRequest) {
  return {
    comments: request.slots.map((slot, index) => ({
      slotId: slot.slotId,
      personaId: slot.personaId,
      text: `живая реплика ${request.sequence}-${index}`,
      language: slot.language,
      kind: slot.kind,
      ...(slot.dialogueId ? { dialogueId: slot.dialogueId } : {}),
      ...(slot.dialogueAction ? { dialogueAction: slot.dialogueAction } : {}),
      ...(slot.replyTarget ? { replyTarget: slot.replyTarget } : {}),
    })),
  };
}

function createScheduler(commentsPerMinute = 8): {
  scheduler: CommentScheduler;
  setQueue(value: number): void;
  enqueue: ReturnType<typeof vi.fn>;
} {
  let queueSize = 0;
  const enqueue = vi.fn((comments: GeneratedAudienceComment[]) => {
    queueSize += comments.length;
    return comments.length;
  });
  const scheduler = {
    enqueue,
    resetTopic: vi.fn(() => {
      queueSize = 0;
    }),
    signalSceneEvent: vi.fn(),
    get queueSize() {
      return queueSize;
    },
    get bufferSeconds() {
      return (queueSize * 60) / commentsPerMinute;
    },
  } as unknown as CommentScheduler;
  return {
    scheduler,
    setQueue(value) {
      queueSize = value;
    },
    enqueue,
  };
}

afterEach(() => {
  useSessionStore.getState().clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AI comment pipeline orchestration', () => {
  it('analyzes visual context before generating an exact comment batch', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push({ path, body });
      if (path === '/api/v1/context/analyze') return json(semanticContext);
      return json(generatedBatch(body as unknown as CommentGenerationRequest));
    });
    vi.stubGlobal('fetch', fetch);
    const runtime = createScheduler();
    const controller = new AbortController();
    const director = new ConversationDirector(broadcast.seed, roster);
    director.recordRendered(
      {
        slotId: 'viewer_question_turn',
        personaId: 'persona_1',
        text: 'а где тебе больше понравилось?',
        language: 'ru',
        kind: 'question',
        dialogueId: 'host_dialogue_pipeline',
        dialogueAction: 'ask_host',
        replyTarget: { type: 'host', transcriptSequence: 0 },
      },
      Date.now(),
    );
    const pipeline = new AiCommentPipeline({
      broadcast,
      roster,
      scheduler: runtime.scheduler,
      director,
      signal: controller.signal,
      getViewers: () => 487,
      getCommentsPerMinute: () => 8,
      getRecentComments: () => [],
      getTranscript: () => [
        {
          sequence: 1,
          text: 'предложите какую-нибудь тему для разговора',
          startedAtMs: 100,
          endedAtMs: 900,
          language: 'ru',
        },
      ],
      isCurrent: () => true,
      onStatus: vi.fn(),
      now: () => Date.now(),
    });

    pipeline.attachVideo(document.createElement('video'));
    pipeline.transcriptChanged();
    pipeline.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(requests.map((request) => request.path)).toEqual([
      '/api/v1/context/analyze',
      '/api/v1/comments/generate',
    ]);
    expect(requests[0]?.body).toMatchObject({
      frameDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      frameMetadata: {
        width: 430,
        height: 932,
        byteLength: 8,
        meanLuminance: 0.42,
        darkPixelRatio: 0.21,
      },
      transcriptSegments: [{ text: 'предложите какую-нибудь тему для разговора' }],
      newTranscriptSequences: [1],
      previousContext: { sceneSummary: '', conversationSummary: '' },
    });
    const commentRequest = requests[1]?.body as unknown as CommentGenerationRequest;
    expect(commentRequest.semanticContext).toEqual({
      ...semanticContext,
      hostIntent: 'request_topics',
      hostTarget: {
        type: 'none',
        transcriptSequence: 0,
        dialogueId: '',
        turnId: '',
        personaId: '',
      },
    });
    expect(requests[0]?.body.openDialogues).toEqual([
      expect.objectContaining({
        dialogueId: 'host_dialogue_pipeline',
        personaId: 'persona_1',
        status: 'awaiting_host',
      }),
    ]);
    expect(commentRequest.openDialogues).toEqual(requests[0]?.body.openDialogues);
    expect(commentRequest.slots.some((slot) => slot.kind === 'question')).toBe(false);
    expect(commentRequest.slots).toHaveLength(10);
    expect(commentRequest.personas).toHaveLength(1);
    expect(commentRequest).not.toHaveProperty('frameDataUrl');
    expect(runtime.enqueue).toHaveBeenCalledOnce();

    pipeline.stop();
    controller.abort();
  });

  it('consumes a question invitation after one accepted batch without repeating it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    let contextCalls = 0;
    const commentRequests: CommentGenerationRequest[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (path === '/api/v1/context/analyze') {
        contextCalls += 1;
        return json(semanticContext);
      }
      const request = body as unknown as CommentGenerationRequest;
      commentRequests.push(request);
      return json(generatedBatch(request));
    });
    vi.stubGlobal('fetch', fetch);
    const runtime = createScheduler();
    const controller = new AbortController();
    const pipeline = new AiCommentPipeline({
      broadcast,
      roster,
      scheduler: runtime.scheduler,
      director: new ConversationDirector(broadcast.seed, roster),
      signal: controller.signal,
      getViewers: () => 500,
      getCommentsPerMinute: () => 8,
      getRecentComments: () => [],
      getTranscript: () => [
        {
          sequence: 1,
          text: 'задайте мне вопросы по жизни',
          startedAtMs: 100,
          endedAtMs: 900,
          language: 'ru',
        },
      ],
      isCurrent: () => true,
      onStatus: vi.fn(),
      now: () => Date.now(),
    });

    pipeline.attachVideo(document.createElement('video'));
    pipeline.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(contextCalls).toBe(1);
    expect(commentRequests).toHaveLength(1);
    expect(commentRequests[0]?.semanticContext.hostIntent).toBe('request_questions');
    expect(
      commentRequests[0]?.slots.filter((slot) =>
        slot.instruction.startsWith('Задай конкретный вопрос'),
      ).length,
    ).toBeGreaterThanOrEqual(1);

    runtime.setQueue(0);
    pipeline.bufferChanged(0, false);
    await vi.advanceTimersByTimeAsync(3_500);

    expect(contextCalls).toBe(1);
    expect(commentRequests).toHaveLength(2);
    expect(commentRequests[1]?.semanticContext).toMatchObject({
      conversationSummary: '',
      topic: '',
      hostIntent: 'ambient',
      hostTarget: { type: 'none' },
      audienceDirection: { reactToSpeech: false, suggestedTopics: [], keyFacts: [] },
    });
    expect(
      commentRequests[1]?.slots.some((slot) =>
        slot.instruction.startsWith('Задай конкретный вопрос'),
      ),
    ).toBe(false);

    pipeline.stop();
    controller.abort();
  });

  it('clears every volatile semantic field when context analysis fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    const storyContext: SemanticContext = {
      ...semanticContext,
      hostIntent: 'story',
      hostTarget: { ...EMPTY_SEMANTIC_CONTEXT.hostTarget },
    };
    let contextCalls = 0;
    const contextRequests: ContextAnalysisRequest[] = [];
    const commentRequests: CommentGenerationRequest[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (path === '/api/v1/context/analyze') {
        contextCalls += 1;
        contextRequests.push(body as unknown as ContextAnalysisRequest);
        if (contextCalls === 1) return json(storyContext);
        return json(
          {
            error: {
              code: 'CONTEXT_RESPONSE_INVALID',
              message: 'Контекст временно недоступен.',
              retryable: false,
            },
          },
          422,
        );
      }
      const request = body as unknown as CommentGenerationRequest;
      commentRequests.push(request);
      return json(generatedBatch(request));
    });
    vi.stubGlobal('fetch', fetch);
    const runtime = createScheduler();
    const controller = new AbortController();
    const statuses = vi.fn();
    let transcript = [
      { sequence: 1, text: 'поговорим о поездках', startedAtMs: 0, endedAtMs: 900 },
    ];
    const pipeline = new AiCommentPipeline({
      broadcast,
      roster,
      scheduler: runtime.scheduler,
      director: new ConversationDirector(broadcast.seed, roster),
      signal: controller.signal,
      getViewers: () => 500,
      getCommentsPerMinute: () => 8,
      getRecentComments: () => [],
      getTranscript: () => transcript,
      isCurrent: () => true,
      onStatus: statuses,
      now: () => Date.now(),
    });

    pipeline.attachVideo(document.createElement('video'));
    pipeline.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(commentRequests).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(6_000);
    runtime.setQueue(0);
    transcript = [
      ...transcript,
      { sequence: 2, text: 'я бы выбрал Рим', startedAtMs: 6_000, endedAtMs: 6_800 },
    ];
    pipeline.transcriptChanged();
    await vi.advanceTimersByTimeAsync(0);

    expect(contextCalls).toBe(2);
    expect(contextRequests[1]?.newTranscriptSequences).toEqual([2]);
    expect(commentRequests).toHaveLength(2);
    expect(commentRequests[1]?.semanticContext).toMatchObject({
      sceneSummary: '',
      conversationSummary: '',
      topic: '',
      hostIntent: 'ambient',
      hostTarget: { type: 'none' },
      presenterContext: { visibleCount: 0, event: 'none', complimentTargetId: 'none' },
      visualGrounding: { status: 'none' },
      audienceDirection: {
        reactToSpeech: false,
        suggestedTopics: [],
        keyFacts: [],
      },
    });
    expect(statuses).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'backoff' }));

    pipeline.stop();
    controller.abort();
  });

  it('isolates an invalid comment response from the live session and prevents request storms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
    let commentCalls = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/v1/context/analyze') return json(semanticContext);
      commentCalls += 1;
      return json(
        {
          error: {
            code: 'AI_RESPONSE_INVALID',
            message: 'Модель вернула невалидный пакет.',
            retryable: true,
          },
        },
        502,
      );
    });
    vi.stubGlobal('fetch', fetch);
    const mediaStream = { getTracks: () => [] } as unknown as MediaStream;
    useSessionStore
      .getState()
      .activate(broadcast, { src: 'blob:active-video', stream: mediaStream }, 487, 1_240);
    const runtime = createScheduler();
    const controller = new AbortController();
    const onStatus = vi.fn((status) => useSessionStore.getState().setCommentPipelineStatus(status));
    const pipeline = new AiCommentPipeline({
      broadcast,
      roster,
      scheduler: runtime.scheduler,
      director: new ConversationDirector(broadcast.seed, roster),
      signal: controller.signal,
      getViewers: () => useSessionStore.getState().viewers,
      getCommentsPerMinute: () => 8,
      getRecentComments: () => useSessionStore.getState().comments,
      getTranscript: () => [],
      isCurrent: () => useSessionStore.getState().sessionId === broadcast.sessionId,
      onStatus,
      now: () => Date.now(),
    });

    pipeline.attachVideo(document.createElement('video'));
    pipeline.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(commentCalls).toBe(1);
    expect(onStatus).toHaveBeenCalledWith({
      state: 'backoff',
      retryAt: expect.any(Number),
      reason: 'AI_RESPONSE_INVALID',
    });
    expect(runtime.enqueue).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'active',
      sessionId: broadcast.sessionId,
      viewers: 487,
      likes: 1_240,
      commentPipelineStatus: {
        state: 'backoff',
        reason: 'AI_RESPONSE_INVALID',
      },
    });
    expect(useSessionStore.getState().media).toMatchObject({
      src: 'blob:active-video',
      stream: mediaStream,
    });

    pipeline.requestSoon();
    pipeline.bufferChanged(0, false);
    pipeline.requestSoon();
    await vi.advanceTimersByTimeAsync(COMMENT_BACKOFF_BASE_MS - 1);
    expect(commentCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(commentCalls).toBe(2);
    expect(controller.signal.aborted).toBe(false);

    pipeline.stop();
    controller.abort();
  });

  it('aborts an in-flight request and removes its watchdog while the page is paused', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal;
          requestSignal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const runtime = createScheduler();
    const controller = new AbortController();
    const onStatus = vi.fn();
    const pipeline = new AiCommentPipeline({
      broadcast,
      roster,
      scheduler: runtime.scheduler,
      director: new ConversationDirector(broadcast.seed, roster),
      signal: controller.signal,
      getViewers: () => 500,
      getCommentsPerMinute: () => 8,
      getRecentComments: () => [],
      getTranscript: () => [],
      isCurrent: () => true,
      onStatus,
      now: () => Date.now(),
    });

    pipeline.attachVideo(document.createElement('video'));
    pipeline.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(requestSignal).toBeDefined();
    pipeline.pause('hidden');
    expect(requestSignal?.aborted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(onStatus).toHaveBeenLastCalledWith({ state: 'paused', reason: 'hidden' });

    pipeline.stop();
    controller.abort();
    expect(vi.getTimerCount()).toBe(0);
  });
});
