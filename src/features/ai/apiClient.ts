import {
  parseRuntimeGeneratedCommentBatch,
  parseRuntimeSemanticContext,
  type ContextAnalysisRequest,
  type CommentGenerationRequest,
  type GeneratedCommentBatch,
  type SemanticContext,
} from '@/features/ai/contracts';

const CONTEXT_TIMEOUT_MS = 8_000;
const COMMENT_TIMEOUT_MS = 25_000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function secureJitter(maximum: number): number {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  return (value / 4_294_967_296) * maximum;
}

interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    requestId?: string;
  };
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs: number,
    readonly code: string,
  ) {
    super(message);
  }
}

function createRequestSignal(
  parent: AbortSignal,
  timeoutMs: number,
): {
  signal: AbortSignal;
  cleanup(): void;
} {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timeout);
      parent.removeEventListener('abort', abort);
    },
  };
}

function retryAfter(response: Response, body: ApiErrorEnvelope): number {
  const fromBody = body.error?.retryAfterMs;
  if (typeof fromBody === 'number') return Math.max(0, fromBody);
  const header = response.headers.get('retry-after');
  if (!header) return 0;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? 0 : Math.max(0, date - Date.now());
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Запрос отменён', 'AbortError'));
      return;
    }
    const cleanup = () => signal.removeEventListener('abort', abort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException('Запрос отменён', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function requestWithRetry(
  createRequest: (signal: AbortSignal) => Promise<Response>,
  signal: AbortSignal,
  timeoutMs: number,
  maxRetries = MAX_RETRIES,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const request = createRequestSignal(signal, timeoutMs);
    try {
      const response = await createRequest(request.signal);
      if (response.ok) return response;
      const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
      const waitMs = retryAfter(response, body);
      const code = body.error?.code ?? 'API_ERROR';
      const retryableResponse =
        RETRYABLE_STATUS.has(response.status) &&
        body.error?.retryable !== false &&
        code !== 'AI_RESPONSE_INVALID';
      const retryRequest = retryableResponse && response.status !== 429 && attempt < maxRetries;
      if (!retryRequest)
        throw new ApiRequestError(
          body.error?.message ?? `API вернул ${response.status}`,
          response.status,
          body.error?.retryable === true || retryableResponse,
          waitMs,
          code,
        );
      await delay(waitMs || 350 * 2 ** attempt + secureJitter(180), signal);
    } catch (error) {
      if (signal.aborted) throw new DOMException('Запрос отменён', 'AbortError');
      if (error instanceof ApiRequestError) throw error;
      if (attempt >= maxRetries)
        throw new ApiRequestError('AI-сервис временно недоступен.', 0, true, 0, 'NETWORK_ERROR');
      await delay(350 * 2 ** attempt + secureJitter(180), signal);
    } finally {
      request.cleanup();
    }
  }
  throw new ApiRequestError('AI-сервис временно недоступен.', 0, true, 0, 'NETWORK_ERROR');
}

export async function generateComments(
  request: CommentGenerationRequest,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<GeneratedCommentBatch> {
  const response = await requestWithRetry(
    (requestSignal) =>
      fetch('/api/v1/comments/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(request),
        signal: requestSignal,
      }),
    signal,
    COMMENT_TIMEOUT_MS,
  );
  return parseRuntimeGeneratedCommentBatch(await response.json());
}

export async function analyzeContext(
  request: ContextAnalysisRequest,
  idempotencyKey: string,
  signal: AbortSignal,
): Promise<SemanticContext> {
  const response = await requestWithRetry(
    (requestSignal) =>
      fetch('/api/v1/context/analyze', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
        },
        body: JSON.stringify(request),
        signal: requestSignal,
      }),
    signal,
    CONTEXT_TIMEOUT_MS,
    0,
  );
  return parseRuntimeSemanticContext(await response.json());
}
