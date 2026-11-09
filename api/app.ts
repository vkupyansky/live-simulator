import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { ZodError } from 'zod';
import type { ApiConfig } from './config.js';
import {
  commentGenerationRequestSchema,
  contextAnalysisRequestSchema,
  type GeneratedAudienceComment,
} from './contracts.js';
import { AiUpstreamError, type AiGateway, type AiUsage } from './gateway.js';
import { IdempotencyCache } from './idempotency.js';
import { registerSpeechStreaming } from './speech.js';
import { isSameHttpOrigin } from './origin.js';
import {
  missingCommentSlots,
  parseAndValidateGeneratedBatch,
  parseAndValidateSemanticContext,
  type GeneratedBatchValidation,
  type ValidationIssue,
} from './validation.js';

const API_BODY_MAX_BYTES = 800_000;
const CONTEXT_UPSTREAM_TIMEOUT_MS = 20_000;
const COMMENT_UPSTREAM_TIMEOUT_MS = 20_000;
const RATE_LIMIT_WINDOW_MS = 60_000;

class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface ApiDependencies {
  config: ApiConfig;
  gateway: AiGateway;
  idempotency?: IdempotencyCache;
  logger?: FastifyServerOptions['logger'];
  contextTimeoutMs?: number;
  commentTimeoutMs?: number;
}

function upstreamAbort(raw: FastifyRequest['raw'], timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const disconnect = () => controller.abort();
  raw.once('aborted', disconnect);
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      clearTimeout(timeout);
      raw.off('aborted', disconnect);
    },
  };
}

function idempotencyKey(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{8,200}$/.test(value))
    throw new ApiHttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key обязателен.');
  return value;
}

async function requireSameOrigin(request: FastifyRequest): Promise<void> {
  if (!isSameHttpOrigin(request.headers.origin, request.headers.host))
    throw new ApiHttpError(403, 'ORIGIN_REJECTED', 'Запрос разрешён только из приложения.');
}

function errorEnvelope(requestId: string, error: ApiHttpError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      requestId,
    },
  };
}

function usageDiagnostics(...usages: Array<AiUsage | null>) {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const usage of usages) {
    promptTokens += usage?.promptTokens ?? 0;
    completionTokens += usage?.completionTokens ?? 0;
    totalTokens += usage?.totalTokens ?? 0;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function transcriptDiagnostics(
  segments: ReadonlyArray<{ readonly text: string; readonly language?: string | undefined }>,
) {
  const text = segments.map((segment) => segment.text).join(' ');
  const letters = Array.from(text).filter((character) => /\p{L}/u.test(character));
  const cyrillic = letters.filter((character) => /\p{Script=Cyrillic}/u.test(character));
  return {
    transcriptSegmentCount: segments.length,
    transcriptCharacterCount: Array.from(text).length,
    transcriptWordCount: text.split(/\s+/u).filter(Boolean).length,
    transcriptCyrillicPercent:
      letters.length === 0 ? 0 : Math.round((cyrillic.length / letters.length) * 100),
    latestTranscriptLanguage: segments.at(-1)?.language ?? 'unknown',
  };
}

function validationDiagnostics(
  sequence: number,
  requestedBatchSize: number,
  validation: GeneratedBatchValidation,
  repairAttempt: 0 | 1,
) {
  return {
    event: 'comment_batch_validation',
    sequence,
    requestedBatchSize,
    receivedItems: validation.receivedItems,
    validItems: validation.comments.length,
    invalidItems: validation.invalidItems,
    issuePaths: validation.issues.map((issue) => issue.path),
    issueCodes: validation.issues.map((issue) => issue.code),
    repairAttempt,
  };
}

function issueDiagnostics(issues: readonly ValidationIssue[]) {
  return {
    issuePaths: issues.map((issue) => issue.path),
    issueCodes: issues.map((issue) => issue.code),
  };
}

function orderComments(
  slotIds: readonly string[],
  comments: readonly GeneratedAudienceComment[],
): GeneratedAudienceComment[] {
  const bySlot = new Map(comments.map((comment) => [comment.slotId, comment]));
  return slotIds.flatMap((slotId) => {
    const comment = bySlot.get(slotId);
    return comment ? [comment] : [];
  });
}

export async function createApi(dependencies: ApiDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: dependencies.logger ?? false,
    bodyLimit: API_BODY_MAX_BYTES,
    requestIdHeader: false,
    trustProxy: true,
  });
  const cache = dependencies.idempotency ?? new IdempotencyCache();

  await app.register(websocket, { options: { maxPayload: 65_536 } });
  await app.register(rateLimit, {
    global: false,
    max: 30,
    timeWindow: RATE_LIMIT_WINDOW_MS,
    cache: 2_000,
    errorResponseBuilder() {
      return new ApiHttpError(
        429,
        'RATE_LIMITED',
        'Слишком много запросов.',
        true,
        RATE_LIMIT_WINDOW_MS,
      );
    },
  });

  app.setErrorHandler((error, request, reply) => {
    let normalized: ApiHttpError;
    if (error instanceof ApiHttpError) normalized = error;
    else if (error instanceof AiUpstreamError)
      normalized = new ApiHttpError(
        error.status,
        error.code,
        'AI-модель временно не обработала запрос.',
        error.retryable,
        error.retryAfterMs,
      );
    else if (error instanceof ZodError) {
      request.log.warn({
        event: 'request_validation_failed',
        requestId: request.id,
        route: request.routeOptions.url,
        issuePaths: error.issues.map((issue) => issue.path.join('.') || 'root'),
        issueCodes: error.issues.map((issue) => issue.code),
      });
      normalized = new ApiHttpError(
        422,
        'VALIDATION_ERROR',
        error.issues[0]?.message ?? 'Запрос не прошёл проверку.',
      );
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 429
    )
      normalized = new ApiHttpError(
        429,
        'RATE_LIMITED',
        'Слишком много запросов.',
        true,
        RATE_LIMIT_WINDOW_MS,
      );
    else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || error.code === 'FST_REQ_FILE_TOO_LARGE')
    )
      normalized = new ApiHttpError(413, 'PAYLOAD_TOO_LARGE', 'Запрос превышает лимит.');
    else if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'FST_ERR_CTP_INVALID_JSON_BODY'
    )
      normalized = new ApiHttpError(400, 'INVALID_JSON', 'Некорректный JSON.');
    else normalized = new ApiHttpError(500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервиса.', true);
    request.log.warn({
      event: 'api_request_failed',
      requestId: request.id,
      route: request.routeOptions.url,
      status: normalized.status,
      code: normalized.code,
    });
    void reply.code(normalized.status).send(errorEnvelope(request.id, normalized));
  });

  app.get('/api/v1/health', async () => ({
    status: 'ok',
    contextModel: dependencies.config.mistralContextModel,
    commentModel: dependencies.config.mistralCommentModel,
    transcriptionModel: dependencies.config.deepgramModel,
    structuredOutputMode: 'json-schema',
  }));

  registerSpeechStreaming(app, dependencies.config);

  app.post(
    '/api/v1/context/analyze',
    {
      bodyLimit: API_BODY_MAX_BYTES,
      preHandler: requireSameOrigin,
      config: { rateLimit: { max: 20, timeWindow: RATE_LIMIT_WINDOW_MS } },
    },
    async (request) => {
      const key = idempotencyKey(request.headers['idempotency-key']);
      const body = contextAnalysisRequestSchema.parse(request.body);
      return await cache.getOrCreate(`context:${key}`, async () => {
        const startedAt = performance.now();
        const operation = upstreamAbort(
          request.raw,
          dependencies.contextTimeoutMs ?? CONTEXT_UPSTREAM_TIMEOUT_MS,
        );
        try {
          request.log.info({
            event: 'context_analysis_received',
            requestId: request.id,
            sequence: body.sequence,
            model: dependencies.config.mistralContextModel,
            frameIncluded: Boolean(body.frameDataUrl),
            frameWidth: body.frameMetadata?.width ?? 0,
            frameHeight: body.frameMetadata?.height ?? 0,
            frameBytes: body.frameMetadata?.byteLength ?? 0,
            frameMeanLuminancePercent: Math.round((body.frameMetadata?.meanLuminance ?? 0) * 100),
            frameContrastPercent: Math.round((body.frameMetadata?.luminanceDeviation ?? 0) * 100),
            frameDarkPixelPercent: Math.round((body.frameMetadata?.darkPixelRatio ?? 0) * 100),
            frameClippedBlackPercent: Math.round(
              (body.frameMetadata?.clippedBlackRatio ?? 0) * 100,
            ),
            sceneChanged: body.sceneChanged,
            transcriptChanged: body.transcriptChanged,
            ...transcriptDiagnostics(body.transcriptSegments),
          });
          const initial = await dependencies.gateway.analyzeContext(body, operation.signal, null);
          const initialValidation = parseAndValidateSemanticContext(initial.content, body);
          request.log.info({
            event: 'context_validation',
            requestId: request.id,
            sequence: body.sequence,
            valid: Boolean(initialValidation.context),
            repairAttempt: 0,
            ...issueDiagnostics(initialValidation.issues),
          });
          if (initialValidation.context) {
            request.log.info({
              event: 'context_analyzed',
              requestId: request.id,
              sequence: body.sequence,
              repairAttempt: 0,
              durationMs: Math.round(performance.now() - startedAt),
              hostIntent: initialValidation.context.hostIntent,
              reactToSpeech: initialValidation.context.audienceDirection.reactToSpeech,
              suggestedTopicCount:
                initialValidation.context.audienceDirection.suggestedTopics.length,
              ...usageDiagnostics(initial.usage),
            });
            return initialValidation.context;
          }

          const repaired = await dependencies.gateway.analyzeContext(body, operation.signal, {
            issues: initialValidation.issues,
          });
          const repairValidation = parseAndValidateSemanticContext(repaired.content, body);
          request.log.info({
            event: 'context_validation',
            requestId: request.id,
            sequence: body.sequence,
            valid: Boolean(repairValidation.context),
            repairAttempt: 1,
            ...issueDiagnostics(repairValidation.issues),
          });
          if (!repairValidation.context)
            throw new ApiHttpError(
              502,
              'AI_RESPONSE_INVALID',
              'Контекст эфира временно не обновлён.',
              true,
            );
          request.log.info({
            event: 'context_analyzed',
            requestId: request.id,
            sequence: body.sequence,
            repairAttempt: 1,
            durationMs: Math.round(performance.now() - startedAt),
            hostIntent: repairValidation.context.hostIntent,
            reactToSpeech: repairValidation.context.audienceDirection.reactToSpeech,
            suggestedTopicCount: repairValidation.context.audienceDirection.suggestedTopics.length,
            ...usageDiagnostics(initial.usage, repaired.usage),
          });
          return repairValidation.context;
        } catch (error) {
          if (operation.didTimeOut())
            throw new ApiHttpError(503, 'UPSTREAM_TIMEOUT', 'AI-модель не ответила вовремя.', true);
          throw error;
        } finally {
          operation.cleanup();
        }
      });
    },
  );

  app.post(
    '/api/v1/comments/generate',
    {
      bodyLimit: API_BODY_MAX_BYTES,
      preHandler: requireSameOrigin,
      config: { rateLimit: { max: 20, timeWindow: RATE_LIMIT_WINDOW_MS } },
    },
    async (request) => {
      const key = idempotencyKey(request.headers['idempotency-key']);
      const body = commentGenerationRequestSchema.parse(request.body);
      return await cache.getOrCreate(`comments:${key}`, async () => {
        const startedAt = performance.now();
        const operation = upstreamAbort(
          request.raw,
          dependencies.commentTimeoutMs ?? COMMENT_UPSTREAM_TIMEOUT_MS,
        );
        try {
          request.log.info({
            event: 'comment_context_received',
            requestId: request.id,
            sequence: body.sequence,
            model: dependencies.config.mistralCommentModel,
            requestedBatchSize: body.slots.length,
            personaCount: body.personas.length,
            ...transcriptDiagnostics(body.transcriptSegments),
          });
          const initial = await dependencies.gateway.generateComments(body, operation.signal, null);
          const initialValidation = parseAndValidateGeneratedBatch(initial.content, body);
          request.log.info({
            ...validationDiagnostics(body.sequence, body.slots.length, initialValidation, 0),
            requestId: request.id,
            model: dependencies.config.mistralCommentModel,
          });
          if (initialValidation.comments.length === body.slots.length) {
            request.log.info({
              event: 'comments_generated',
              requestId: request.id,
              sequence: body.sequence,
              requestedBatchSize: body.slots.length,
              validItems: initialValidation.comments.length,
              repairAttempt: 0,
              durationMs: Math.round(performance.now() - startedAt),
              ...usageDiagnostics(initial.usage),
            });
            return {
              comments: orderComments(
                body.slots.map((slot) => slot.slotId),
                initialValidation.comments,
              ),
            };
          }

          const missingSlots = missingCommentSlots(body, initialValidation);
          const repaired = await dependencies.gateway.generateComments(body, operation.signal, {
            issues: initialValidation.issues,
            missingSlots,
            acceptedComments: initialValidation.acceptedOutputs,
          });
          const repairValidation = parseAndValidateGeneratedBatch(
            repaired.content,
            body,
            initialValidation.acceptedOutputs,
          );
          request.log.info({
            ...validationDiagnostics(body.sequence, missingSlots.length, repairValidation, 1),
            requestId: request.id,
            model: dependencies.config.mistralCommentModel,
          });
          const combined = [...initialValidation.comments, ...repairValidation.comments];
          const ordered = orderComments(
            body.slots.map((slot) => slot.slotId),
            combined,
          );
          const acceptedSlotIds = new Set(ordered.map((comment) => comment.slotId));
          const invitedQuestionMissing =
            body.semanticContext.hostIntent === 'request_questions' &&
            body.slots.some(
              (slot) => slot.kind === 'question' && !acceptedSlotIds.has(slot.slotId),
            );
          if (ordered.length === 0 || invitedQuestionMissing)
            throw new ApiHttpError(
              502,
              'AI_RESPONSE_INVALID',
              'Комментарии временно восстанавливаются.',
              true,
            );
          request.log.info({
            event: 'comments_generated',
            requestId: request.id,
            sequence: body.sequence,
            requestedBatchSize: body.slots.length,
            validItems: ordered.length,
            repairAttempt: 1,
            durationMs: Math.round(performance.now() - startedAt),
            ...usageDiagnostics(initial.usage, repaired.usage),
          });
          return { comments: ordered };
        } catch (error) {
          if (operation.didTimeOut())
            throw new ApiHttpError(503, 'UPSTREAM_TIMEOUT', 'AI-модель не ответила вовремя.', true);
          throw error;
        } finally {
          operation.cleanup();
        }
      });
    },
  );

  return app;
}
