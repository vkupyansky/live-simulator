import { describe, expect, it, vi } from 'vitest';
import { analyzeContext, generateComments } from '@/features/ai/apiClient';
import {
  EMPTY_SEMANTIC_CONTEXT,
  type CommentGenerationRequest,
  type ContextAnalysisRequest,
} from '@/features/ai/contracts';

const request: CommentGenerationRequest = {
  sessionId: 'session_retry_test',
  sequence: 1,
  currentViewers: 100,
  targetViewers: 100,
  activity: 'normal',
  host: { displayName: 'Host', username: 'host.live' },
  personas: [
    {
      id: 'persona_1',
      username: 'mira.wave',
      displayName: 'Mira',
      avatarSeed: 'seed',
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
  ],
  slots: [
    {
      slotId: 'slot_1_0',
      personaId: 'persona_1',
      language: 'ru',
      kind: 'greeting',
      length: 'short',
      casing: 'lower',
      allowEmoji: false,
      allowTypo: false,
      allowVisualClaim: false,
      instruction: 'Поздоровайся естественно.',
    },
  ],
  recentComments: [],
  noveltyTexts: [],
  personaMemories: [],
  openDialogues: [],
  transcriptSegments: [],
  semanticContext: EMPTY_SEMANTIC_CONTEXT,
};

const contextRequest: ContextAnalysisRequest = {
  sessionId: request.sessionId,
  sequence: 1,
  currentViewers: request.currentViewers,
  targetViewers: request.targetViewers,
  activity: request.activity,
  host: request.host,
  transcriptSegments: [],
  newTranscriptSequences: [],
  recentComments: [],
  openDialogues: [],
  previousContext: EMPTY_SEMANTIC_CONTEXT,
  sceneChanged: false,
  transcriptChanged: false,
};

const success = () =>
  new Response(
    JSON.stringify({
      comments: [
        {
          slotId: 'slot_1_0',
          personaId: 'persona_1',
          text: 'привет',
          language: 'ru',
          kind: 'greeting',
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const failure = (status: number, retryable = false, retryAfter = '', code = 'API_ERROR') =>
  new Response(JSON.stringify({ error: { code, message: `status ${status}`, retryable } }), {
    status,
    headers: {
      'content-type': 'application/json',
      ...(retryAfter ? { 'retry-after': retryAfter } : {}),
    },
  });

describe('same-origin API retry policy', () => {
  it.each([400, 401, 403, 413, 415, 422])('does not retry HTTP %s', async (status) => {
    const fetch = vi.fn(async () => failure(status));
    vi.stubGlobal('fetch', fetch);
    await expect(
      generateComments(request, `non-retry-${status}`, new AbortController().signal),
    ).rejects.toThrow(`status ${status}`);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('retries 500/502 with the same idempotency key and succeeds on the third attempt', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => success())
      .mockResolvedValueOnce(failure(500, true))
      .mockResolvedValueOnce(failure(502, true))
      .mockResolvedValueOnce(success());
    vi.stubGlobal('fetch', fetch);
    const result = generateComments(request, 'stable-retry-key', new AbortController().signal);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ comments: [{ text: 'привет' }] });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map((call) => call[1]?.headers)).toEqual([
      expect.objectContaining({ 'idempotency-key': 'stable-retry-key' }),
      expect.objectContaining({ 'idempotency-key': 'stable-retry-key' }),
      expect.objectContaining({ 'idempotency-key': 'stable-retry-key' }),
    ]);
  });

  it('delegates a 429 Retry-After to pipeline backoff without an HTTP request storm', async () => {
    const throttledFetch = vi.fn(async () => failure(429, true, '1'));
    vi.stubGlobal('fetch', throttledFetch);
    await expect(
      generateComments(request, 'rate-limit-key', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'API_ERROR', retryable: true, retryAfterMs: 1_000 });
    expect(throttledFetch).toHaveBeenCalledOnce();
  });

  it('does not retry a controlled 503', async () => {
    const configurationFetch = vi.fn(async () => failure(503, false));
    vi.stubGlobal('fetch', configurationFetch);
    await expect(
      generateComments(request, 'configuration-key', new AbortController().signal),
    ).rejects.toThrow('status 503');
    expect(configurationFetch).toHaveBeenCalledOnce();
  });

  it('keeps an exhausted gateway timeout retryable for pipeline backoff', async () => {
    vi.useFakeTimers();
    const gatewayFetch = vi.fn(async () => new Response('', { status: 504 }));
    vi.stubGlobal('fetch', gatewayFetch);
    const result = generateComments(request, 'gateway-timeout-key', new AbortController().signal);
    const rejection = expect(result).rejects.toMatchObject({ status: 504, retryable: true });
    await vi.runAllTimersAsync();
    await rejection;
    expect(gatewayFetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry optional context analysis before comment generation can continue', async () => {
    const fetch = vi.fn(async () => failure(503, true));
    vi.stubGlobal('fetch', fetch);
    await expect(
      analyzeContext(contextRequest, 'context-no-retry-key', new AbortController().signal),
    ).rejects.toMatchObject({ status: 503, retryable: true });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('leaves AI_RESPONSE_INVALID to the comment pipeline instead of retrying the HTTP request', async () => {
    const fetch = vi.fn(async () => failure(502, true, '', 'AI_RESPONSE_INVALID'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      generateComments(request, 'invalid-ai-response-key', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'AI_RESPONSE_INVALID',
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('aborts pending backoff without another request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => failure(500, true));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const result = generateComments(request, 'abort-retry-key', controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await expect(result).rejects.toThrow('Запрос отменён');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
