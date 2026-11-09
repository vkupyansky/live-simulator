// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApi, type ApiDependencies } from '../api/app.js';
import { readApiConfig, validateModelCapabilities, type ApiConfig } from '../api/config.js';
import type {
  CommentGenerationRequest,
  ContextAnalysisRequest,
  SemanticContext,
} from '../api/contracts.js';
import type { AiGateway } from '../api/gateway.js';
import { IdempotencyCache } from '../api/idempotency.js';
import {
  copiesTranscript,
  jaccardSimilarity,
  parseAndValidateGeneratedBatch,
  parseAndValidateSemanticContext,
} from '../api/validation.js';

const apps: Awaited<ReturnType<typeof createApi>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

const config: ApiConfig = {
  appDomain: 'live.example.test',
  mistralApiKey: 'mistral-unit-test-secret',
  mistralApiBaseUrl: 'https://api.mistral.test',
  mistralContextModel: 'mistral-medium-3-5',
  mistralCommentModel: 'mistral-small-2603',
  deepgramApiKey: 'deepgram-unit-test-secret',
  deepgramStreamingBaseUrl: 'wss://api.deepgram.test',
  deepgramModel: 'flux-general-multi',
  deepgramLanguageHint: 'ru',
  deepgramEotThreshold: 0.7,
  deepgramEotTimeoutMs: 1_200,
};

const semanticContext: SemanticContext = {
  sceneSummary: 'ведущий сидит перед камерой в комнате',
  conversationSummary: 'ведущий обсуждает съёмку прямого эфира',
  topic: 'камера для стрима',
  topicResetSequence: 0,
  hostIntent: 'story',
  hostTarget: { type: 'none', transcriptSequence: 0, dialogueId: '', turnId: '', personaId: '' },
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
    questionShare: 0.2,
    suggestedTopics: ['свет в комнате'],
    keyFacts: ['ведущий выбирает камеру'],
  },
};

function personas(): CommentGenerationRequest['personas'] {
  return [
    {
      id: 'persona_ru_1',
      username: 'mira.wave',
      displayName: 'Mira',
      avatarSeed: 'seed-one',
      primaryLanguage: 'ru',
      style: {
        casing: 'lower',
        language: 'ru',
        tone: 'casual',
        typoProbability: 0.08,
        emojiProbability: 0.05,
        activityWeight: 2,
      },
    },
    {
      id: 'persona_en_1',
      username: 'north.frame',
      displayName: 'North',
      avatarSeed: 'seed-two',
      primaryLanguage: 'en',
      style: {
        casing: 'sentence',
        language: 'en',
        tone: 'question',
        typoProbability: 0.03,
        emojiProbability: 0.04,
        activityWeight: 1.3,
      },
    },
    {
      id: 'persona_ru_2',
      username: 'quiet.pixel',
      displayName: 'Pixel',
      avatarSeed: 'seed-three',
      primaryLanguage: 'ru',
      style: {
        casing: 'lower',
        language: 'ru',
        tone: 'supportive',
        typoProbability: 0.06,
        emojiProbability: 0.03,
        activityWeight: 1.6,
      },
    },
  ];
}

function commentRequest(): CommentGenerationRequest {
  return {
    sessionId: 'session_12345678',
    sequence: 2,
    currentViewers: 510,
    targetViewers: 500,
    activity: 'normal',
    host: { displayName: 'Host', username: 'host.live' },
    personas: personas(),
    slots: [
      {
        slotId: 'slot_1',
        personaId: 'persona_ru_1',
        language: 'ru',
        kind: 'speech_reaction',
        length: 'short',
        casing: 'lower',
        allowEmoji: false,
        allowTypo: false,
        allowVisualClaim: false,
        instruction: 'Коротко отреагируй на выбор камеры.',
        dialogueId: 'dialogue_1',
        dialogueAction: 'start_viewer',
      },
      {
        slotId: 'slot_2',
        personaId: 'persona_en_1',
        language: 'en',
        kind: 'question',
        length: 'medium',
        casing: 'sentence',
        allowEmoji: false,
        allowTypo: false,
        allowVisualClaim: false,
        instruction: 'Ask one concrete question about the setup.',
      },
      {
        slotId: 'slot_3',
        personaId: 'persona_ru_2',
        language: 'ru',
        kind: 'viewer_reply',
        length: 'medium',
        casing: 'lower',
        allowEmoji: false,
        allowTypo: true,
        allowVisualClaim: false,
        instruction: 'Естественно продолжи короткую ветку зрителей.',
        dialogueId: 'dialogue_1',
        dialogueAction: 'reply_viewer',
        replyTarget: { type: 'viewer', personaId: 'persona_ru_1', turnId: 'slot_1' },
      },
    ],
    recentComments: [{ personaId: 'persona_ru_1', text: 'звук сейчас чистый' }],
    noveltyTexts: ['как давно идёт эфир'],
    personaMemories: [
      {
        personaId: 'persona_ru_1',
        recentMessages: ['звук сейчас чистый'],
        participationCount: 3,
      },
    ],
    openDialogues: [],
    transcriptSegments: [
      {
        sequence: 1,
        text: 'сегодня выбираю камеру для будущих эфиров',
        startedAtMs: 100,
        endedAtMs: 1_200,
        language: 'ru',
      },
    ],
    semanticContext,
  };
}

function contextRequest(): ContextAnalysisRequest {
  return {
    sessionId: 'session_12345678',
    sequence: 1,
    currentViewers: 510,
    targetViewers: 500,
    activity: 'normal',
    host: { displayName: 'Host', username: 'host.live' },
    transcriptSegments: [
      {
        sequence: 1,
        text: 'сегодня выбираю камеру для будущих эфиров',
        startedAtMs: 100,
        endedAtMs: 1_200,
        language: 'ru',
      },
    ],
    newTranscriptSequences: [1],
    recentComments: [{ personaId: 'persona_ru_1', text: 'звук сейчас чистый' }],
    openDialogues: [],
    previousContext: {
      ...semanticContext,
      audienceDirection: { ...semanticContext.audienceDirection },
    },
    frameDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    frameMetadata: {
      width: 430,
      height: 932,
      byteLength: 8,
      meanLuminance: 0.42,
      luminanceDeviation: 0.18,
      darkPixelRatio: 0.21,
      clippedBlackRatio: 0.03,
    },
    sceneChanged: true,
    transcriptChanged: true,
  };
}

function validCommentContent(order: readonly string[] = ['slot_1', 'slot_2', 'slot_3']): string {
  const bySlot = {
    slot_1: { slotId: 'slot_1', text: 'а эта камера не греется?' },
    slot_2: { slotId: 'slot_2', text: 'Does it handle low light well?' },
    slot_3: { slotId: 'slot_3', text: 'тоже интересно, особенно вечером' },
  };
  return JSON.stringify({
    comments: order.map((slotId) => bySlot[slotId as keyof typeof bySlot]),
  });
}

function validContextContent(): string {
  return JSON.stringify(semanticContext);
}

function gateway(): AiGateway {
  return {
    probeCapabilities: vi.fn(async () => ({
      vision: true,
      contextAnalysis: true,
      commentGeneration: true,
      structuredOutputMode: 'json-schema' as const,
    })),
    analyzeContext: vi.fn(async () => ({ content: validContextContent(), usage: null })),
    generateComments: vi.fn(async () => ({
      content: validCommentContent(),
      usage: { promptTokens: 80, completionTokens: 30, totalTokens: 110 },
    })),
  };
}

async function testApp(
  aiGateway: AiGateway = gateway(),
  logger: ApiDependencies['logger'] = false,
) {
  const app = await createApi({
    config,
    gateway: aiGateway,
    logger,
  });
  apps.push(app);
  return app;
}

function postComments(
  app: Awaited<ReturnType<typeof createApi>>,
  key: string,
  payload: CommentGenerationRequest = commentRequest(),
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/comments/generate',
    headers: {
      host: config.appDomain,
      origin: `https://${config.appDomain}`,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    payload,
  });
}

function postContext(app: Awaited<ReturnType<typeof createApi>>, key: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/context/analyze',
    headers: {
      host: config.appDomain,
      origin: `https://${config.appDomain}`,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    payload: contextRequest(),
  });
}

describe('API configuration and health', () => {
  it('requires every production environment variable without fallbacks', () => {
    const environment = {
      APP_DOMAIN: config.appDomain,
      MISTRAL_API_KEY: config.mistralApiKey,
      MISTRAL_API_BASE_URL: config.mistralApiBaseUrl,
      MISTRAL_CONTEXT_MODEL: config.mistralContextModel,
      MISTRAL_COMMENT_MODEL: config.mistralCommentModel,
      DEEPGRAM_API_KEY: config.deepgramApiKey,
      DEEPGRAM_STREAMING_BASE_URL: config.deepgramStreamingBaseUrl,
      DEEPGRAM_MODEL: config.deepgramModel,
      DEEPGRAM_LANGUAGE_HINT: config.deepgramLanguageHint,
      DEEPGRAM_EOT_THRESHOLD: String(config.deepgramEotThreshold),
      DEEPGRAM_EOT_TIMEOUT_MS: String(config.deepgramEotTimeoutMs),
    };

    for (const name of Object.keys(environment)) {
      const incomplete: Record<string, string> = { ...environment };
      delete incomplete[name];
      expect(() => readApiConfig(incomplete)).toThrow(`${name} is required`);
    }
    expect(readApiConfig(environment)).toEqual(config);
  });

  it('rejects insecure upstream URLs and a single model reused for both roles', () => {
    expect(() =>
      readApiConfig({
        APP_DOMAIN: config.appDomain,
        MISTRAL_API_KEY: config.mistralApiKey,
        MISTRAL_API_BASE_URL: 'http://api.mistral.test',
        MISTRAL_CONTEXT_MODEL: config.mistralContextModel,
        MISTRAL_COMMENT_MODEL: config.mistralCommentModel,
        DEEPGRAM_API_KEY: config.deepgramApiKey,
        DEEPGRAM_STREAMING_BASE_URL: config.deepgramStreamingBaseUrl,
        DEEPGRAM_MODEL: config.deepgramModel,
        DEEPGRAM_LANGUAGE_HINT: config.deepgramLanguageHint,
        DEEPGRAM_EOT_THRESHOLD: '0.7',
        DEEPGRAM_EOT_TIMEOUT_MS: '1200',
      }),
    ).toThrow();
    expect(() =>
      readApiConfig({
        APP_DOMAIN: config.appDomain,
        MISTRAL_API_KEY: config.mistralApiKey,
        MISTRAL_API_BASE_URL: config.mistralApiBaseUrl,
        MISTRAL_CONTEXT_MODEL: 'same-model',
        MISTRAL_COMMENT_MODEL: 'same-model',
        DEEPGRAM_API_KEY: config.deepgramApiKey,
        DEEPGRAM_STREAMING_BASE_URL: config.deepgramStreamingBaseUrl,
        DEEPGRAM_MODEL: config.deepgramModel,
        DEEPGRAM_LANGUAGE_HINT: config.deepgramLanguageHint,
        DEEPGRAM_EOT_THRESHOLD: '0.7',
        DEEPGRAM_EOT_TIMEOUT_MS: '1200',
      }),
    ).toThrow('Context and comment models must be configured independently.');
  });

  it('reports only active Mistral and Deepgram model diagnostics', async () => {
    const app = await testApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      contextModel: 'mistral-medium-3-5',
      commentModel: 'mistral-small-2603',
      transcriptionModel: 'flux-general-multi',
      structuredOutputMode: 'json-schema',
    });
    expect(response.body).not.toContain(config.mistralApiKey);
    expect(response.body).not.toContain(config.deepgramApiKey);
  });

  it('accepts the production Mistral capability split and rejects missing vision', () => {
    expect(() =>
      validateModelCapabilities({
        vision: true,
        contextAnalysis: true,
        commentGeneration: true,
        structuredOutputMode: 'json-schema',
      }),
    ).not.toThrow();
    expect(() =>
      validateModelCapabilities({
        vision: false,
        contextAnalysis: true,
        commentGeneration: true,
        structuredOutputMode: 'json-schema',
      }),
    ).toThrow('does not accept image input');
  });
});

describe('context analysis API', () => {
  it('accepts one valid structured context response without repair', async () => {
    const aiGateway = gateway();
    const app = await testApp(aiGateway);
    const response = await postContext(app, 'context-valid-key');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(semanticContext);
    expect(aiGateway.analyzeContext).toHaveBeenCalledOnce();
    expect(vi.mocked(aiGateway.analyzeContext).mock.calls[0]?.[2]).toBeNull();
  });

  it('fails closed without repair when the model carries stale visual grounding', async () => {
    const staleGrounding: SemanticContext['visualGrounding'] = {
      status: 'uncertain',
      label: 'наушники',
      transcriptSequence: 18,
      frameSequence: 18,
    };
    const request: ContextAnalysisRequest = {
      ...contextRequest(),
      sequence: 19,
      transcriptSegments: [
        {
          sequence: 19,
          text: 'давайте поговорим о чём-нибудь другом',
          startedAtMs: 20_000,
          endedAtMs: 21_000,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [19],
      previousContext: { ...semanticContext, visualGrounding: staleGrounding },
      sceneChanged: false,
      transcriptChanged: true,
    };
    delete request.frameDataUrl;
    delete request.frameMetadata;
    const carriedContext: SemanticContext = {
      ...semanticContext,
      visualGrounding: staleGrounding,
    };
    const aiGateway = gateway();
    vi.mocked(aiGateway.analyzeContext).mockResolvedValueOnce({
      content: JSON.stringify(carriedContext),
      usage: null,
    });
    const app = await testApp(aiGateway);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/context/analyze',
      headers: {
        host: config.appDomain,
        origin: `https://${config.appDomain}`,
        'content-type': 'application/json',
        'idempotency-key': 'context-stale-visual-key',
      },
      payload: request,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().visualGrounding).toEqual({
      status: 'none',
      label: '',
      transcriptSequence: 0,
      frameSequence: 0,
    });
    expect(aiGateway.analyzeContext).toHaveBeenCalledOnce();
  });

  it('performs exactly one repair and accepts its validated result', async () => {
    const aiGateway = gateway();
    vi.mocked(aiGateway.analyzeContext)
      .mockResolvedValueOnce({ content: '{"topic":false}', usage: null })
      .mockResolvedValueOnce({ content: validContextContent(), usage: null });
    const app = await testApp(aiGateway);
    const response = await postContext(app, 'context-repair-key');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(semanticContext);
    expect(aiGateway.analyzeContext).toHaveBeenCalledTimes(2);
    expect(vi.mocked(aiGateway.analyzeContext).mock.calls[1]?.[2]).toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: expect.stringMatching(/SCHEMA_INVALID/u) }),
      ]),
    });
  });

  it('returns retryable AI_RESPONSE_INVALID after one failed repair and does not cache it', async () => {
    const aiGateway = gateway();
    vi.mocked(aiGateway.analyzeContext).mockResolvedValue({ content: 'not-json', usage: null });
    const app = await testApp(aiGateway);
    const first = await postContext(app, 'context-invalid-key');
    expect(first.statusCode).toBe(502);
    expect(first.json().error).toMatchObject({ code: 'AI_RESPONSE_INVALID', retryable: true });
    expect(aiGateway.analyzeContext).toHaveBeenCalledTimes(2);
    const retry = await postContext(app, 'context-invalid-key');
    expect(retry.statusCode).toBe(502);
    expect(aiGateway.analyzeContext).toHaveBeenCalledTimes(4);
  });
});

describe('comment generation API', () => {
  it('validates exact slots and restores director order before returning', async () => {
    const aiGateway = gateway();
    vi.mocked(aiGateway.generateComments).mockResolvedValueOnce({
      content: validCommentContent(['slot_3', 'slot_1', 'slot_2']),
      usage: null,
    });
    const app = await testApp(aiGateway);
    const response = await postComments(app, 'comment-order-key');
    expect(response.statusCode).toBe(200);
    expect(response.json().comments.map((comment: { slotId: string }) => comment.slotId)).toEqual([
      'slot_1',
      'slot_2',
      'slot_3',
    ]);
    expect(response.json().comments).toEqual([
      expect.objectContaining({
        slotId: 'slot_1',
        personaId: 'persona_ru_1',
        language: 'ru',
        kind: 'speech_reaction',
      }),
      expect.objectContaining({
        slotId: 'slot_2',
        personaId: 'persona_en_1',
        language: 'en',
        kind: 'question',
      }),
      expect.objectContaining({
        slotId: 'slot_3',
        dialogueId: 'dialogue_1',
        dialogueAction: 'reply_viewer',
        replyTarget: { type: 'viewer', personaId: 'persona_ru_1', turnId: 'slot_1' },
      }),
    ]);
  });

  it('repairs only missing slots once and idempotently caches the repaired final batch', async () => {
    const aiGateway = gateway();
    vi.mocked(aiGateway.generateComments)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          comments: [
            { slotId: 'slot_1', text: 'а эта камера не греется?' },
            { slotId: 'slot_2', text: 'смешанный язык is invalid' },
          ],
        }),
        usage: { totalTokens: 30 },
      })
      .mockResolvedValueOnce({
        content: validCommentContent(['slot_2', 'slot_3']),
        usage: { totalTokens: 20 },
      });
    const app = await testApp(aiGateway);
    const options = {
      method: 'POST' as const,
      url: '/api/v1/comments/generate',
      headers: {
        host: config.appDomain,
        origin: `https://${config.appDomain}`,
        'content-type': 'application/json',
        'idempotency-key': 'comment-repaired-final-key',
      },
      payload: commentRequest(),
    };
    const [first, inFlightDuplicate] = await Promise.all([
      app.inject(options),
      app.inject(options),
    ]);
    const cached = await app.inject(options);
    expect(first.statusCode).toBe(200);
    expect(inFlightDuplicate.body).toBe(first.body);
    expect(cached.body).toBe(first.body);
    expect(aiGateway.generateComments).toHaveBeenCalledTimes(2);
    const repair = vi.mocked(aiGateway.generateComments).mock.calls[1]?.[2];
    expect(repair).toMatchObject({
      missingSlots: [{ slotId: 'slot_2' }, { slotId: 'slot_3' }],
      acceptedComments: [{ slotId: 'slot_1', text: 'а эта камера не греется?' }],
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'LANGUAGE_MISMATCH' }),
        expect.objectContaining({ code: 'SLOT_MISSING' }),
      ]),
    });
  });

  it('returns the validated subset when repair cannot replace only the missing slots', async () => {
    const aiGateway = gateway();
    vi.mocked(aiGateway.generateComments)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          comments: [
            { slotId: 'slot_1', text: 'А эта камера не греется?' },
            { slotId: 'slot_2', text: 'смешанный language' },
          ],
        }),
        usage: null,
      })
      .mockResolvedValueOnce({ content: 'not-json', usage: null });
    const app = await testApp(aiGateway);
    const response = await postComments(app, 'comment-partial-valid-key');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      comments: [
        expect.objectContaining({
          slotId: 'slot_1',
          text: 'а эта камера не греется?',
        }),
      ],
    });
    expect(aiGateway.generateComments).toHaveBeenCalledTimes(2);
  });

  it('does not consume an invitation when repair still misses its planned question', async () => {
    const aiGateway = gateway();
    vi.mocked(aiGateway.generateComments)
      .mockResolvedValueOnce({
        content: JSON.stringify({
          comments: [
            { slotId: 'slot_1', text: 'интересная тема' },
            { slotId: 'slot_2', text: 'What should we ask you?' },
          ],
        }),
        usage: null,
      })
      .mockResolvedValueOnce({ content: 'not-json', usage: null });
    const app = await testApp(aiGateway);
    const request = commentRequest();
    request.semanticContext = {
      ...request.semanticContext,
      hostIntent: 'request_questions',
      hostTarget: {
        type: 'audience',
        transcriptSequence: 1,
        dialogueId: '',
        turnId: '',
        personaId: '',
      },
    };
    const response = await postComments(app, 'comment-invitation-missing-question', request);

    expect(response.statusCode).toBe(502);
    expect(response.json().error).toMatchObject({
      code: 'AI_RESPONSE_INVALID',
      retryable: true,
    });
    expect(aiGateway.generateComments).toHaveBeenCalledTimes(2);
  });

  it('returns retryable AI_RESPONSE_INVALID after one failed repair and never caches failures', async () => {
    const aiGateway = gateway();
    vi.mocked(aiGateway.generateComments).mockResolvedValue({ content: 'not-json', usage: null });
    const app = await testApp(aiGateway);
    const first = await postComments(app, 'comment-invalid-key');
    expect(first.statusCode).toBe(502);
    expect(first.json().error).toMatchObject({ code: 'AI_RESPONSE_INVALID', retryable: true });
    expect(aiGateway.generateComments).toHaveBeenCalledTimes(2);
    const retry = await postComments(app, 'comment-invalid-key');
    expect(retry.statusCode).toBe(502);
    expect(aiGateway.generateComments).toHaveBeenCalledTimes(4);
  });

  it('rejects an invalid request before calling the model', async () => {
    const aiGateway = gateway();
    const app = await testApp(aiGateway);
    const invalidRequest = commentRequest();
    const firstSlot = invalidRequest.slots[0];
    if (!firstSlot) throw new Error('Comment fixture requires one slot');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/comments/generate',
      headers: {
        host: config.appDomain,
        origin: `https://${config.appDomain}`,
        'content-type': 'application/json',
        'idempotency-key': 'invalid-request-key',
      },
      payload: { ...invalidRequest, slots: [{ ...firstSlot, personaId: 'missing' }] },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
    expect(aiGateway.generateComments).not.toHaveBeenCalled();
  });

  it('accepts matching HTTP/HTTPS origins on any deployed host and rejects cross-site calls', async () => {
    const aiGateway = gateway();
    const app = await testApp(aiGateway);
    const local = await app.inject({
      method: 'POST',
      url: '/api/v1/comments/generate',
      headers: {
        host: '192.168.0.2',
        origin: 'http://192.168.0.2',
        'content-type': 'application/json',
        'idempotency-key': 'local-origin-key',
      },
      payload: commentRequest(),
    });
    expect(local.statusCode).toBe(200);

    const crossSite = await app.inject({
      method: 'POST',
      url: '/api/v1/comments/generate',
      headers: {
        host: config.appDomain,
        origin: 'https://untrusted.example',
        'content-type': 'application/json',
        'idempotency-key': 'cross-site-key',
      },
      payload: commentRequest(),
    });
    expect(crossSite.statusCode).toBe(403);
    expect(crossSite.json().error.code).toBe('ORIGIN_REJECTED');
    expect(aiGateway.generateComments).toHaveBeenCalledOnce();
  });
});

describe('safe structured diagnostics', () => {
  it('does not log API keys, frame bytes, transcript text or full AI output', async () => {
    const lines: string[] = [];
    const aiGateway = gateway();
    vi.mocked(aiGateway.analyzeContext).mockResolvedValueOnce({
      content: validContextContent(),
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });
    const app = await testApp(aiGateway, {
      level: 'info',
      stream: { write: (line: string) => lines.push(line) },
    });
    const response = await postContext(app, 'safe-logging-key');
    expect(response.statusCode).toBe(200);
    const logs = lines.join('\n');
    expect(logs).toContain('context_analysis_received');
    expect(logs).toContain('transcriptCharacterCount');
    expect(logs).toContain('"frameWidth":430');
    expect(logs).toContain('"frameDarkPixelPercent":21');
    expect(logs).not.toContain(config.mistralApiKey);
    expect(logs).not.toContain(config.deepgramApiKey);
    expect(logs).not.toContain(contextRequest().frameDataUrl);
    expect(logs).not.toContain(contextRequest().transcriptSegments[0]?.text);
    expect(logs).not.toContain(semanticContext.sceneSummary);
    expect(logs).not.toContain(validContextContent());
  });
});

describe('domain validation', () => {
  it('distinguishes invalid JSON, schema and semantic context failures', () => {
    expect(parseAndValidateSemanticContext('not-json', contextRequest()).issues).toEqual([
      { path: 'root', code: 'JSON_INVALID' },
    ]);
    expect(
      parseAndValidateSemanticContext(
        JSON.stringify({ ...semanticContext, extra: true }),
        contextRequest(),
      ).issues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ROOT_SCHEMA_INVALID' })]));
    const withoutFrame = contextRequest();
    delete withoutFrame.frameDataUrl;
    delete withoutFrame.frameMetadata;
    expect(
      parseAndValidateSemanticContext(
        JSON.stringify({
          ...semanticContext,
          presenterContext: {
            ...semanticContext.presenterContext,
            complimentTargetId: 'primary',
            complimentCue: 'аккуратная укладка',
          },
        }),
        withoutFrame,
      ).issues,
    ).toContainEqual({
      path: 'presenterContext.complimentCue',
      code: 'CONTEXT_DOMAIN_INVALID',
    });

    expect(
      parseAndValidateSemanticContext(
        JSON.stringify({
          ...semanticContext,
          hostIntent: 'request_topics',
          audienceDirection: { ...semanticContext.audienceDirection, suggestedTopics: [] },
        }),
        contextRequest(),
      ).issues,
    ).toContainEqual({
      path: 'audienceDirection.suggestedTopics',
      code: 'CONTEXT_DOMAIN_INVALID',
    });
  });

  it('clears stale grounding and downgrades first-frame certainty without rejecting context', () => {
    const request = contextRequest();
    const inconsistentNone = {
      ...semanticContext,
      visualGrounding: {
        status: 'none',
        label: 'старый предмет',
        transcriptSequence: 1,
        frameSequence: 1,
      },
    };
    expect(parseAndValidateSemanticContext(JSON.stringify(inconsistentNone), request)).toEqual({
      context: semanticContext,
      issues: [],
    });
    const uncertain: SemanticContext = {
      ...semanticContext,
      visualGrounding: {
        status: 'uncertain',
        label: 'умные часы',
        transcriptSequence: 1,
        frameSequence: 1,
      },
    };
    expect(parseAndValidateSemanticContext(JSON.stringify(uncertain), request)).toEqual({
      context: uncertain,
      issues: [],
    });

    const firstFrameConfirmation: SemanticContext = {
      ...uncertain,
      visualGrounding: { ...uncertain.visualGrounding, status: 'confirmed' },
    };
    expect(
      parseAndValidateSemanticContext(JSON.stringify(firstFrameConfirmation), request),
    ).toEqual({ context: uncertain, issues: [] });

    const confirmationRequest: ContextAnalysisRequest = {
      ...request,
      sequence: 2,
      transcriptSegments: [
        ...request.transcriptSegments,
        {
          sequence: 2,
          text: 'получше видно сейчас?',
          startedAtMs: 1_300,
          endedAtMs: 1_900,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [2],
      previousContext: uncertain,
    };
    const confirmed: SemanticContext = {
      ...uncertain,
      visualGrounding: {
        status: 'confirmed',
        label: 'умные часы',
        transcriptSequence: 2,
        frameSequence: 2,
      },
    };
    expect(parseAndValidateSemanticContext(JSON.stringify(confirmed), confirmationRequest)).toEqual(
      { context: confirmed, issues: [] },
    );

    const withoutFrame = { ...confirmationRequest };
    delete withoutFrame.frameDataUrl;
    delete withoutFrame.frameMetadata;
    expect(parseAndValidateSemanticContext(JSON.stringify(confirmed), withoutFrame)).toEqual({
      context: {
        ...confirmed,
        sceneSummary: '',
        visualGrounding: {
          status: 'none',
          label: '',
          transcriptSequence: 0,
          frameSequence: 0,
        },
      },
      issues: [],
    });
    expect(
      parseAndValidateSemanticContext(
        JSON.stringify({
          ...uncertain,
          visualGrounding: { ...uncertain.visualGrounding, label: 'смартфон на лбу' },
        }),
        request,
      ).issues,
    ).toContainEqual({ path: 'visualGrounding.label', code: 'CONTEXT_DOMAIN_INVALID' });

    const staleForbiddenRequest = { ...request };
    delete staleForbiddenRequest.frameDataUrl;
    delete staleForbiddenRequest.frameMetadata;
    expect(
      parseAndValidateSemanticContext(
        JSON.stringify({
          ...uncertain,
          visualGrounding: { ...uncertain.visualGrounding, label: 'смартфон на лбу' },
        }),
        staleForbiddenRequest,
      ).issues,
    ).toContainEqual({ path: 'visualGrounding.label', code: 'CONTEXT_DOMAIN_INVALID' });
  });

  it('bounds harmless model text overflow instead of dropping the live context', () => {
    const oversizedFact = 'факт '.repeat(40);
    const content = JSON.stringify({
      ...semanticContext,
      audienceDirection: {
        ...semanticContext.audienceDirection,
        suggestedTopics: Array.from({ length: 8 }, (_, index) => `тема ${index}`),
        keyFacts: Array.from({ length: 10 }, () => oversizedFact),
      },
    });
    const result = parseAndValidateSemanticContext(content, contextRequest());

    expect(result.issues).toEqual([]);
    expect(result.context?.audienceDirection.suggestedTopics).toHaveLength(6);
    expect(result.context?.audienceDirection.keyFacts).toHaveLength(8);
    expect(result.context?.audienceDirection.keyFacts.every((fact) => fact.length <= 120)).toBe(
      true,
    );
  });

  it('rejects ungrounded audio-quality claims in semantic context but allows audio topics', () => {
    const claims: Array<[keyof SemanticContext, string]> = [
      ['sceneSummary', 'ведущего плохо слышно'],
      ['conversationSummary', 'что-то с микрофоном'],
      ['topic', 'звук постоянно пропадает'],
    ];
    for (const [field, value] of claims) {
      const result = parseAndValidateSemanticContext(
        JSON.stringify({ ...semanticContext, [field]: value }),
        contextRequest(),
      );
      expect(result.issues).toContainEqual({
        path: field,
        code: 'AUDIO_CLAIM_NOT_GROUNDED',
      });
    }

    const keyFactResult = parseAndValidateSemanticContext(
      JSON.stringify({
        ...semanticContext,
        audienceDirection: {
          ...semanticContext.audienceDirection,
          keyFacts: ['the sound keeps cutting out'],
        },
      }),
      contextRequest(),
    );
    expect(keyFactResult.issues).toContainEqual({
      path: 'audienceDirection.keyFacts.0',
      code: 'AUDIO_CLAIM_NOT_GROUNDED',
    });

    const ordinaryTopics = parseAndValidateSemanticContext(
      JSON.stringify({
        ...semanticContext,
        conversationSummary: 'ведущий любит музыку и выбирает технику',
        topic: 'выбор микрофона',
        audienceDirection: {
          ...semanticContext.audienceDirection,
          suggestedTopics: ['какой микрофон купить'],
          keyFacts: ['ведущий любит музыку'],
        },
      }),
      contextRequest(),
    );
    expect(ordinaryTopics.issues).toEqual([]);
  });

  it('canonically clears carried visual grounding on a topic reset', () => {
    const reset: SemanticContext = {
      ...semanticContext,
      topicResetSequence: 1,
      hostIntent: 'request_topics',
      visualGrounding: {
        status: 'uncertain',
        label: 'умные часы',
        transcriptSequence: 1,
        frameSequence: 1,
      },
    };
    const cleared: SemanticContext = {
      ...reset,
      visualGrounding: {
        status: 'none',
        label: '',
        transcriptSequence: 0,
        frameSequence: 0,
      },
    };
    expect(parseAndValidateSemanticContext(JSON.stringify(reset), contextRequest())).toEqual({
      context: cleared,
      issues: [],
    });
    expect(
      parseAndValidateSemanticContext(JSON.stringify(cleared), contextRequest()).issues,
    ).toEqual([]);
  });

  it('accepts only an exact open-dialogue host target and rejects invented addressees', () => {
    const request: ContextAnalysisRequest = {
      ...contextRequest(),
      openDialogues: [
        {
          dialogueId: 'dialogue_host_1',
          personaId: 'persona_ru_1',
          displayName: 'Mira',
          username: 'mira.wave',
          language: 'ru',
          status: 'awaiting_host',
          turns: [
            {
              turnId: 'viewer_turn_1',
              role: 'viewer',
              personaId: 'persona_ru_1',
              text: 'а какой объектив ты выбрал?',
              replyToTurnId: '',
            },
          ],
        },
      ],
    };
    const targeted: SemanticContext = {
      ...semanticContext,
      hostIntent: 'answer',
      hostTarget: {
        type: 'viewer',
        transcriptSequence: 1,
        dialogueId: 'dialogue_host_1',
        turnId: 'viewer_turn_1',
        personaId: 'persona_ru_1',
      },
    };
    expect(parseAndValidateSemanticContext(JSON.stringify(targeted), request)).toEqual({
      context: targeted,
      issues: [],
    });
    expect(
      parseAndValidateSemanticContext(JSON.stringify(targeted), {
        ...request,
        transcriptSegments: [
          ...request.transcriptSegments,
          {
            sequence: 2,
            text: 'а теперь расскажу про свет',
            startedAtMs: 1_300,
            endedAtMs: 2_000,
          },
        ],
        newTranscriptSequences: [2],
      }).issues,
    ).toContainEqual({ path: 'hostTarget', code: 'CONTEXT_DOMAIN_INVALID' });
    expect(
      parseAndValidateSemanticContext(
        JSON.stringify({
          ...targeted,
          hostTarget: { ...targeted.hostTarget, turnId: 'invented_turn' },
        }),
        request,
      ).issues,
    ).toContainEqual({ path: 'hostTarget', code: 'CONTEXT_DOMAIN_INVALID' });
    expect(
      parseAndValidateSemanticContext(JSON.stringify(targeted), {
        ...request,
        newTranscriptSequences: [],
        transcriptChanged: false,
      }).issues,
    ).toContainEqual({ path: 'hostTarget', code: 'CONTEXT_DOMAIN_INVALID' });
    expect(
      parseAndValidateSemanticContext(
        JSON.stringify({ ...targeted, hostIntent: 'ambient' }),
        request,
      ).issues,
    ).toContainEqual({ path: 'hostTarget', code: 'CONTEXT_DOMAIN_INVALID' });

    const rhetoricalQuestion: SemanticContext = {
      ...semanticContext,
      hostIntent: 'question',
      hostTarget: {
        type: 'none',
        transcriptSequence: 0,
        dialogueId: '',
        turnId: '',
        personaId: '',
      },
    };
    expect(parseAndValidateSemanticContext(JSON.stringify(rhetoricalQuestion), request)).toEqual({
      context: rhetoricalQuestion,
      issues: [],
    });
  });

  it('binds an explicit username to only its exact branch among three open dialogues', () => {
    const request: ContextAnalysisRequest = {
      ...contextRequest(),
      transcriptSegments: [
        {
          sequence: 11,
          text: '@quiet.pixel, да, я тоже выбрал бы вечер',
          startedAtMs: 2_000,
          endedAtMs: 3_000,
          language: 'ru',
        },
      ],
      newTranscriptSequences: [11],
      openDialogues: personas().map((persona, index) => ({
        dialogueId: `dialogue_identity_${index}`,
        personaId: persona.id,
        displayName: persona.displayName,
        username: persona.username,
        language: persona.primaryLanguage,
        status: 'awaiting_host' as const,
        turns: [
          {
            turnId: `viewer_identity_${index}`,
            role: 'viewer' as const,
            personaId: persona.id,
            text: index === 2 ? 'вечером лучше снимать?' : `вопрос номер ${index}`,
            replyToTurnId: '',
          },
        ],
      })),
      transcriptChanged: true,
    };
    const target: SemanticContext = {
      ...semanticContext,
      hostIntent: 'answer',
      hostTarget: {
        type: 'viewer',
        transcriptSequence: 11,
        dialogueId: 'dialogue_identity_2',
        turnId: 'viewer_identity_2',
        personaId: 'persona_ru_2',
      },
    };
    expect(parseAndValidateSemanticContext(JSON.stringify(target), request).issues).toEqual([]);
    expect(
      parseAndValidateSemanticContext(
        JSON.stringify({
          ...target,
          hostTarget: {
            type: 'viewer',
            transcriptSequence: 11,
            dialogueId: 'dialogue_identity_0',
            turnId: 'viewer_identity_0',
            personaId: 'persona_ru_1',
          },
        }),
        request,
      ).issues,
    ).toContainEqual({ path: 'hostTarget', code: 'CONTEXT_DOMAIN_INVALID' });
  });

  it('rejects wrong slot, language, emoji, transcript copies and own identity', () => {
    const request = commentRequest();
    const cases = [
      [{ slotId: 'missing_slot', text: 'нормальный комментарий' }, 'SLOT_UNKNOWN'],
      [{ slotId: 'slot_2', text: 'это сообщение по-русски' }, 'LANGUAGE_MISMATCH'],
      [{ slotId: 'slot_1', text: 'неплохая камера 🙂' }, 'EMOJI_NOT_ALLOWED'],
      [{ slotId: 'slot_1', text: 'сегодня выбираю камеру' }, 'TRANSCRIPT_COPY'],
      [{ slotId: 'slot_1', text: 'mira тут' }, 'SELF_IDENTITY_COPY'],
    ] as const;
    for (const [candidate, expectedCode] of cases) {
      const validation = parseAndValidateGeneratedBatch(
        JSON.stringify({ comments: [candidate] }),
        request,
      );
      expect(validation.issues.map((entry) => entry.code)).toContain(expectedCode);
    }

    const emojiRequest = commentRequest();
    const emojiSlot = emojiRequest.slots.find((slot) => slot.slotId === 'slot_3');
    if (!emojiSlot) throw new Error('Emoji fixture requires slot_3');
    emojiSlot.allowEmoji = true;
    const excessEmoji = parseAndValidateGeneratedBatch(
      JSON.stringify({
        comments: [{ slotId: 'slot_3', text: 'вечером особенно интересно 🙂✨' }],
      }),
      emojiRequest,
    );
    expect(excessEmoji.issues.map((entry) => entry.code)).toContain('EMOJI_EXCESS');
  });

  it('rejects question-invitation echoes but accepts concrete audience questions', () => {
    const request = commentRequest();
    request.semanticContext = {
      ...request.semanticContext,
      hostIntent: 'request_questions',
    };
    const echoes = [
      { slotId: 'slot_1', text: 'какие вопросы по жизни?' },
      { slotId: 'slot_1', text: 'какой вопрос тебе задать?' },
      { slotId: 'slot_1', text: 'что у тебя спросить?' },
      { slotId: 'slot_2', text: 'What should we ask you?' },
      { slotId: 'slot_2', text: 'Questions about life' },
    ];
    for (const candidate of echoes) {
      expect(
        parseAndValidateGeneratedBatch(JSON.stringify({ comments: [candidate] }), request).issues,
      ).toContainEqual({ path: 'comments.0.text', code: 'QUESTION_INVITATION_ECHO' });
    }

    const concrete = parseAndValidateGeneratedBatch(
      JSON.stringify({
        comments: [
          { slotId: 'slot_1', text: 'какая цель сейчас для тебя важнее?' },
          { slotId: 'slot_2', text: 'What made you choose your current work?' },
        ],
      }),
      request,
    );
    expect(concrete.acceptedSlotIds).toEqual(['slot_1', 'slot_2']);
    expect(concrete.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'QUESTION_INVITATION_ECHO' })]),
    );
  });

  it('allows a hedged uncertain visual claim only in an explicitly authorized slot', () => {
    const request = commentRequest();
    request.semanticContext = {
      ...request.semanticContext,
      visualGrounding: {
        status: 'uncertain',
        label: 'умные часы',
        transcriptSequence: 1,
        frameSequence: 1,
      },
    };
    const visualSlot = request.slots.find((slot) => slot.slotId === 'slot_1');
    if (!visualSlot) throw new Error('Visual fixture requires slot_1');
    visualSlot.allowVisualClaim = true;

    const accepted = parseAndValidateGeneratedBatch(
      JSON.stringify({ comments: [{ slotId: 'slot_1', text: 'похоже, умные часы' }] }),
      request,
    );
    expect(accepted.acceptedSlotIds).toContain('slot_1');
    expect(accepted.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: expect.stringMatching(/^VISUAL_/u) }),
      ]),
    );

    const unhedged = parseAndValidateGeneratedBatch(
      JSON.stringify({ comments: [{ slotId: 'slot_1', text: 'это умные часы' }] }),
      request,
    );
    expect(unhedged.issues).toContainEqual({
      path: 'comments.0.text',
      code: 'VISUAL_CLAIM_UNCERTAIN',
    });

    const unauthorized = parseAndValidateGeneratedBatch(
      JSON.stringify({ comments: [{ slotId: 'slot_3', text: 'похоже, умные часы' }] }),
      request,
    );
    expect(unauthorized.issues).toContainEqual({
      path: 'comments.0.text',
      code: 'VISUAL_CLAIM_NOT_ALLOWED',
    });

    const bodyRelation = parseAndValidateGeneratedBatch(
      JSON.stringify({ comments: [{ slotId: 'slot_1', text: 'смартфон на лбу' }] }),
      request,
    );
    expect(bodyRelation.issues).toContainEqual({
      path: 'comments.0.text',
      code: 'VISUAL_BODY_RELATION',
    });
  });

  it('rejects ungrounded darkness and visibility claims', () => {
    const request = commentRequest();
    for (const [slotId, text] of [
      ['slot_1', 'там слишком темно'],
      ['slot_1', 'тебя вообще не видно'],
      ['slot_2', "I can't see anything"],
    ] as const) {
      expect(
        parseAndValidateGeneratedBatch(JSON.stringify({ comments: [{ slotId, text }] }), request)
          .issues,
      ).toContainEqual({ path: 'comments.0.text', code: 'VISUAL_CLAIM_NOT_ALLOWED' });
    }
  });

  it('rejects ungrounded audio-quality claims but allows ordinary audio topics', () => {
    const request = commentRequest();
    for (const [slotId, text] of [
      ['slot_1', 'тебя плохо слышно'],
      ['slot_1', 'что-то с микрофоном'],
      ['slot_1', 'микрофон работает нормально'],
      ['slot_1', 'звук пропадает'],
      ['slot_2', "I can't hear you"],
      ['slot_2', 'The microphone is working'],
      ['slot_2', 'The sound keeps cutting out'],
    ] as const) {
      expect(
        parseAndValidateGeneratedBatch(JSON.stringify({ comments: [{ slotId, text }] }), request)
          .issues,
      ).toContainEqual({ path: 'comments.0.text', code: 'AUDIO_CLAIM_NOT_GROUNDED' });
    }

    for (const text of ['какой микрофон купить?', 'люблю музыку']) {
      const result = parseAndValidateGeneratedBatch(
        JSON.stringify({ comments: [{ slotId: 'slot_1', text }] }),
        request,
      );
      expect(result.acceptedSlotIds).toContain('slot_1');
      expect(result.issues).not.toContainEqual({
        path: 'comments.0.text',
        code: 'AUDIO_CLAIM_NOT_GROUNDED',
      });
    }
  });

  it('normalizes only the first letter to the persona style instead of rejecting live text', () => {
    const validation = parseAndValidateGeneratedBatch(
      JSON.stringify({
        comments: [
          { slotId: 'slot_1', text: '«Слишком большая буква»' },
          { slotId: 'slot_2', text: 'is this setup ready?' },
        ],
      }),
      commentRequest(),
    );
    expect(validation.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slotId: 'slot_1', text: '«слишком большая буква»' }),
        expect.objectContaining({ slotId: 'slot_2', text: 'Is this setup ready?' }),
      ]),
    );
    expect(validation.issues).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('text') })]),
    );
  });

  it('filters exact and fuzzy duplicates across history and a generated batch', () => {
    expect(jaccardSimilarity('очень красивый свет', 'свет очень красивый')).toBe(1);
    expect(copiesTranscript('сегодня выбираю камеру', ['Сегодня выбираю камеру для эфира'])).toBe(
      true,
    );
    const request = {
      ...commentRequest(),
      recentComments: [{ personaId: 'persona_ru_1', text: 'какая камера лучше для вечера' }],
    };
    const validation = parseAndValidateGeneratedBatch(
      JSON.stringify({
        comments: [
          { slotId: 'slot_1', text: 'какая камера лучше для вечера' },
          { slotId: 'slot_2', text: 'Is this setup good for low light?' },
          { slotId: 'slot_3', text: 'для вечера какая камера лучше' },
        ],
      }),
      request,
    );
    expect(validation.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_EXACT', 'DUPLICATE_FUZZY']),
    );
  });

  it('deduplicates in-flight work, retains successes and evicts rejected promises', async () => {
    const cache = new IdempotencyCache(() => 1_000, 60_000, 10);
    let resolveOperation: ((value: string) => void) | undefined;
    const operation = vi.fn(
      async () =>
        await new Promise<string>((resolve) => {
          resolveOperation = resolve;
        }),
    );
    const first = cache.getOrCreate('same', operation);
    const duplicate = cache.getOrCreate('same', operation);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledOnce();
    resolveOperation?.('repaired-final');
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      'repaired-final',
      'repaired-final',
    ]);
    await expect(cache.getOrCreate('same', operation)).resolves.toBe('repaired-final');
    expect(operation).toHaveBeenCalledOnce();

    const rejected = vi.fn(async () => {
      throw new Error('invalid');
    });
    await expect(cache.getOrCreate('failed', rejected)).rejects.toThrow('invalid');
    await expect(cache.getOrCreate('failed', rejected)).rejects.toThrow('invalid');
    expect(rejected).toHaveBeenCalledTimes(2);
  });

  it('never evicts in-flight idempotency work when the settled LRU limit is exceeded', async () => {
    let now = 1_000;
    const cache = new IdempotencyCache(() => now, 50, 2);
    const resolvers = new Map<string, (value: string) => void>();
    const operation = (key: string) =>
      vi.fn(
        async () =>
          await new Promise<string>((resolve) => {
            resolvers.set(key, resolve);
          }),
      );
    const firstOperation = operation('first');
    const secondOperation = operation('second');
    const thirdOperation = operation('third');
    const first = cache.getOrCreate('first', firstOperation);
    const second = cache.getOrCreate('second', secondOperation);
    const third = cache.getOrCreate('third', thirdOperation);
    await Promise.resolve();

    now += 100;
    const duplicate = cache.getOrCreate('first', firstOperation);
    expect(firstOperation).toHaveBeenCalledOnce();
    expect(cache.size).toBe(3);

    resolvers.get('first')?.('one');
    resolvers.get('second')?.('two');
    resolvers.get('third')?.('three');
    await expect(Promise.all([first, duplicate, second, third])).resolves.toEqual([
      'one',
      'one',
      'two',
      'three',
    ]);
    expect(cache.size).toBeLessThanOrEqual(2);
  });
});
