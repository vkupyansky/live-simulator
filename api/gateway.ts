import type { ModelCapabilities } from './config.js';
import type {
  CommentGenerationRequest,
  CommentSlot,
  ContextAnalysisRequest,
  GeneratedCommentOutput,
} from './contracts.js';
import type { ValidationIssue } from './validation.js';

export interface AiUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface AiGenerationResult {
  content: string | null;
  usage: AiUsage | null;
}

export class AiUpstreamError extends Error {
  constructor(
    readonly provider: 'mistral',
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(`${provider} upstream request failed`);
  }
}

export interface ContextRepairContext {
  issues: readonly ValidationIssue[];
}

export interface CommentRepairContext {
  issues: readonly ValidationIssue[];
  missingSlots: readonly CommentSlot[];
  acceptedComments: readonly GeneratedCommentOutput[];
}

export interface AiGateway {
  probeCapabilities(signal: AbortSignal): Promise<ModelCapabilities>;
  analyzeContext(
    request: ContextAnalysisRequest,
    signal: AbortSignal,
    repair: ContextRepairContext | null,
  ): Promise<AiGenerationResult>;
  generateComments(
    request: CommentGenerationRequest,
    signal: AbortSignal,
    repair: CommentRepairContext | null,
  ): Promise<AiGenerationResult>;
}
