import { describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../api/config.js';
import type {
  CommentGenerationRequest,
  ContextAnalysisRequest,
  SemanticContext,
} from '../api/contracts.js';
import { AiUpstreamError } from '../api/gateway.js';
import {
  commentRequestPayload,
  contextRequestPayload,
  createMistralGateway,
} from '../api/mistral.js';
import {
  capabilityProbeJsonSchema,
  generatedCommentBatchJsonSchemaForSlots,
  semanticContextJsonSchema,
} from '../api/jsonSchema.js';

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

const context: SemanticContext = {
  sceneSummary: 'ведущий находится перед камерой',
  conversationSummary: 'обсуждается настройка эфира',
  topic: 'освещение',
  topicResetSequence: 0,
  hostIntent: 'request_questions',
  hostTarget: {
    type: 'audience',
    transcriptSequence: 9,
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
    suggestedTopics: ['настройка света'],
    keyFacts: ['ведущий просит задавать вопросы'],
  },
};

function contextRequest(): ContextAnalysisRequest {
  return {
    sessionId: 'session_12345678',
    sequence: 1,
    currentViewers: 420,
    targetViewers: 500,
    activity: 'normal',
    host: { displayName: 'Host', username: 'host.live' },
    transcriptSegments: [
      {
        sequence: 9,
        text: 'давайте поговорим, задавайте вопросы про этот свет',
        startedAtMs: 1_000,
        endedAtMs: 2_200,
        language: 'ru',
      },
    ],
    newTranscriptSequences: [9],
    recentComments: [{ personaId: 'persona_ru', text: 'какая лампа стоит сбоку?' }],
    openDialogues: [
      {
        dialogueId: 'dialogue_1',
        personaId: 'persona_ru',
        displayName: 'Frame',
        username: 'night.frame',
        language: 'ru',
        status: 'awaiting_host',
        turns: [
          {
            turnId: 'turn_1',
            role: 'viewer',
            personaId: 'persona_ru',
            text: 'какая лампа стоит сбоку?',
            replyToTurnId: '',
          },
        ],
      },
    ],
    previousContext: context,
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

function commentRequest(): CommentGenerationRequest {
  return {
    sessionId: 'session_12345678',
    sequence: 2,
    currentViewers: 420,
    targetViewers: 500,
    activity: 'normal',
    host: { displayName: 'Host', username: 'host.live' },
    personas: [
      {
        id: 'persona_ru',
        username: 'night.frame',
        displayName: 'Frame',
        avatarSeed: 'seed',
        primaryLanguage: 'ru',
        style: {
          casing: 'lower',
          language: 'ru',
          tone: 'question',
          typoProbability: 0.05,
          emojiProbability: 0.03,
          activityWeight: 1.5,
        },
      },
    ],
    slots: [
      {
        slotId: 'slot_1',
        personaId: 'persona_ru',
        language: 'ru',
        kind: 'question',
        length: 'medium',
        casing: 'lower',
        allowEmoji: false,
        allowTypo: true,
        allowVisualClaim: false,
        instruction: 'Задай конкретный вопрос о свете.',
      },
    ],
    recentComments: [],
    noveltyTexts: [],
    personaMemories: [],
    openDialogues: contextRequest().openDialogues,
    transcriptSegments: contextRequest().transcriptSegments,
    semanticContext: context,
  };
}

function completion(
  content: string = '{"ok":true}',
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }),
    { status, headers: { 'content-type': 'application/json', ...headers } },
  );
}

interface MistralRequestBody {
  model: string;
  reasoning_effort: string;
  prompt_cache_key: string;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: string }>;
  }>;
  response_format: {
    type: string;
    json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean };
  };
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, index: number): MistralRequestBody {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  if (typeof init?.body !== 'string') throw new Error(`Missing request body at call ${index}`);
  return JSON.parse(init.body) as MistralRequestBody;
}

describe('Mistral gateway capabilities', () => {
  it('probes exact context/comment models and sends a real image to the vision probe', async () => {
    const fetchMock = vi.fn(async () => completion());
    const gateway = createMistralGateway(config, fetchMock);
    await expect(gateway.probeCapabilities(new AbortController().signal)).resolves.toEqual({
      vision: true,
      contextAnalysis: true,
      commentGeneration: true,
      structuredOutputMode: 'json-schema',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = [requestBody(fetchMock, 0), requestBody(fetchMock, 1)];
    expect(bodies.map((body) => body.model).sort()).toEqual(
      ['mistral-medium-3-5', 'mistral-small-2603'].sort(),
    );
    const contextProbe = bodies.find((body) => body.model === 'mistral-medium-3-5');
    expect(contextProbe?.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'image_url',
          image_url: expect.stringMatching(/^data:image/u),
        }),
      ]),
    );
    for (const body of bodies) {
      expect(body.response_format).toMatchObject({
        type: 'json_schema',
        json_schema: { name: 'capability_probe', schema: capabilityProbeJsonSchema },
      });
      expect(body.response_format.json_schema).not.toHaveProperty('strict');
    }
  });
});

describe('Mistral context analysis request', () => {
  it('uses Medium 3.5, includes image and transcript, and requests JSON Schema output', async () => {
    const fetchMock = vi.fn(async () => completion(JSON.stringify(context)));
    const gateway = createMistralGateway(config, fetchMock);
    const result = await gateway.analyzeContext(
      contextRequest(),
      new AbortController().signal,
      null,
    );
    expect(result).toEqual({
      content: JSON.stringify(context),
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    });
    const body = requestBody(fetchMock, 0);
    expect(body.model).toBe('mistral-medium-3-5');
    expect(body.reasoning_effort).toBe('none');
    expect(body.prompt_cache_key).toBe('semantic_live_context');
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'semantic_live_context', schema: semanticContextJsonSchema },
    });
    expect(body.response_format.json_schema).not.toHaveProperty('strict');
    expect(body.messages[1]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image_url', image_url: contextRequest().frameDataUrl }),
      ]),
    );
    const userContent = body.messages[1]?.content;
    if (!Array.isArray(userContent)) throw new Error('Expected multimodal context content');
    const textPart = userContent.find((item: { type?: string }) => item.type === 'text');
    expect(textPart?.text).toContain(contextRequest().transcriptSegments[0]?.text);
    expect(textPart?.text).toContain('transcriptChanged');
    expect(textPart?.text).toContain('newTranscriptSegments');
    expect(textPart?.text).toContain('transcriptBackground');
    expect(textPart?.text).toContain('dialogue_1');
    const contextPayload = JSON.parse(String(textPart?.text)) as { session: { sequence: number } };
    expect(contextPayload.session.sequence).toBe(contextRequest().sequence);
    const systemPrompt = body.messages[0]?.content;
    expect(typeof systemPrompt).toBe('string');
    expect(systemPrompt).toContain('visualGrounding');
    expect(systemPrompt).toContain('первом наблюдении');
    expect(systemPrompt).toContain('topicResetSequence');
    expect(systemPrompt).toContain('recentComments и openDialogues — только история диалога');
    expect(systemPrompt).toContain('без текущего изображения sceneSummary=""');
    expect(systemPrompt).toContain('не читая прежний label как подсказку');
    expect(systemPrompt).toContain('нет машинного сигнала о качестве аудио');
    expect(systemPrompt).toContain('transcript означает только распознанный текст');
    expect(systemPrompt).toContain('ни в одно поле semanticContext');
  });

  it('passes validation issues in one same-model repair without dropping original context', async () => {
    const fetchMock = vi.fn(async () => completion(JSON.stringify(context)));
    const gateway = createMistralGateway(config, fetchMock);
    const request = contextRequest();
    await gateway.analyzeContext(request, new AbortController().signal, {
      issues: [{ path: 'topic', code: 'CONTEXT_SCHEMA_INVALID' }],
    });
    const body = requestBody(fetchMock, 0);
    expect(body.model).toBe('mistral-medium-3-5');
    const serialized = JSON.stringify(body.messages[1]?.content);
    expect(serialized).toContain('CONTEXT_SCHEMA_INVALID');
    expect(serialized).toContain(request.transcriptSegments[0]?.text);
    expect(serialized).toContain(request.frameDataUrl);
  });
});

describe('Mistral comment request', () => {
  it('uses Small 4 with exact slots, transcript and JSON Schema output', async () => {
    const response = JSON.stringify({
      comments: [{ slotId: 'slot_1', text: 'какой свет сбоку?' }],
    });
    const fetchMock = vi.fn(async () => completion(response));
    const gateway = createMistralGateway(config, fetchMock);
    await expect(
      gateway.generateComments(commentRequest(), new AbortController().signal, null),
    ).resolves.toMatchObject({ content: response });
    const body = requestBody(fetchMock, 0);
    expect(body.model).toBe('mistral-small-2603');
    expect(body.reasoning_effort).toBe('none');
    expect(body.prompt_cache_key).toBe('generated_comment_batch');
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'generated_comment_batch',
        schema: generatedCommentBatchJsonSchemaForSlots(commentRequest().slots),
      },
    });
    expect(body.response_format.json_schema).not.toHaveProperty('strict');
    const userContent = body.messages[1]?.content;
    if (typeof userContent !== 'string') throw new Error('Expected textual comment payload');
    const payload = JSON.parse(userContent) as {
      slots: unknown;
      transcript: unknown;
      semanticContext: unknown;
      openDialogues: unknown;
    };
    expect(payload.slots).toEqual(
      commentRequest().slots.map((slot) => ({
        ...slot,
        instruction: `Обязательно: не более 7 слов и 64 символов. ${slot.instruction}`,
        maxWords: 7,
        maxCharacters: 64,
      })),
    );
    expect(payload.transcript).toEqual(commentRequest().transcriptSegments);
    expect(payload.semanticContext).toEqual(context);
    expect(payload.openDialogues).toEqual(commentRequest().openDialogues);
    expect(JSON.stringify(body.messages)).not.toContain('image_url');
    const systemPrompt = body.messages[0]?.content;
    expect(typeof systemPrompt).toBe('string');
    expect(systemPrompt).toContain('allowVisualClaim=true');
    expect(systemPrompt).toContain('Для uncertain обязательно вырази сомнение');
    expect(systemPrompt).toContain('не делай вообще никаких утверждений о кадре');
    expect(systemPrompt).toContain('request_topics и request_questions выполняются ровно один раз');
    expect(systemPrompt).toContain('noveltyTexts — только список для предотвращения повторов');
    expect(systemPrompt).toContain('нет машинного сигнала о качестве аудио');
    expect(systemPrompt).toContain('Это правило выше instruction и dialogueAction');
  });

  it('sends only missing slots plus accepted output and issues during repair', async () => {
    const fetchMock = vi.fn(async () => completion('{"comments":[]}'));
    const gateway = createMistralGateway(config, fetchMock);
    const request = commentRequest();
    await gateway.generateComments(request, new AbortController().signal, {
      issues: [{ path: 'comments.0.text', code: 'LANGUAGE_MISMATCH' }],
      missingSlots: request.slots,
      acceptedComments: [{ slotId: 'accepted_slot', text: 'уже принято' }],
    });
    const body = requestBody(fetchMock, 0);
    expect(body.model).toBe('mistral-small-2603');
    const userContent = body.messages[1]?.content;
    if (typeof userContent !== 'string') throw new Error('Expected textual repair payload');
    const payload = JSON.parse(userContent) as {
      slots: unknown;
      repair: { validationErrors: unknown; accepted: unknown; instruction: string };
    };
    expect(payload.slots).toEqual(
      request.slots.map((slot) => ({
        ...slot,
        instruction: `Обязательно: не более 7 слов и 64 символов. ${slot.instruction}`,
        maxWords: 7,
        maxCharacters: 64,
      })),
    );
    expect(payload.repair).toMatchObject({
      validationErrors: [{ path: 'comments.0.text', code: 'LANGUAGE_MISMATCH' }],
      accepted: [{ slotId: 'accepted_slot', text: 'уже принято' }],
    });
    expect(payload.repair.instruction).toContain('исправленный JSON');
    expect(payload.repair.instruction).toContain('maxCharacters');
    expect(payload.repair.instruction).toContain('maxWords');
    expect(body.response_format.json_schema.schema).toEqual(
      generatedCommentBatchJsonSchemaForSlots(request.slots),
    );
  });

  it('aligns structured output bounds with the requested slot count and text length', async () => {
    const fetchMock = vi.fn(async () => completion('{"comments":[]}'));
    const gateway = createMistralGateway(config, fetchMock);
    const request = commentRequest();
    await gateway.generateComments(request, new AbortController().signal, null);
    const schema = requestBody(fetchMock, 0).response_format.json_schema.schema as {
      properties: {
        comments: {
          minItems: number;
          maxItems: number;
          items: { properties: { text: { maxLength: number } } };
        };
      };
    };
    expect(schema.properties.comments).toMatchObject({ minItems: 1, maxItems: 1 });
    expect(schema.properties.comments.items.properties.text.maxLength).toBe(64);
  });

  it('serializes stable redaction-safe payload helpers without API credentials', () => {
    const contextPayload = contextRequestPayload(contextRequest(), null);
    const commentPayload = commentRequestPayload(commentRequest(), null);
    expect(contextPayload).toContain('transcript');
    expect(contextPayload).not.toContain(config.mistralApiKey);
    expect(contextPayload).not.toContain(contextRequest().frameDataUrl);
    expect(commentPayload).toContain('slot_1');
    expect(commentPayload).not.toContain(config.deepgramApiKey);
  });
});

describe('Mistral upstream errors', () => {
  it('maps rate limits to retryable sanitized errors and honors Retry-After', async () => {
    const fetchMock = vi.fn(async () => completion('{}', 429, { 'retry-after': '2' }));
    const gateway = createMistralGateway(config, fetchMock);
    await expect(
      gateway.generateComments(commentRequest(), new AbortController().signal, null),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AiUpstreamError>>({
        provider: 'mistral',
        status: 429,
        code: 'MISTRAL_RATE_LIMITED',
        retryable: true,
        retryAfterMs: 2_000,
      }),
    );
  });

  it('treats missing choices[0].message.content as an invalid result for domain repair', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: {} }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const gateway = createMistralGateway(config, fetchMock);
    await expect(
      gateway.generateComments(commentRequest(), new AbortController().signal, null),
    ).resolves.toEqual({ content: null, usage: null });
  });
});
