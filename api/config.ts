import { z } from 'zod';

export interface ApiConfig {
  appDomain: string;
  mistralApiKey: string;
  mistralApiBaseUrl: string;
  mistralContextModel: string;
  mistralCommentModel: string;
  deepgramApiKey: string;
  deepgramStreamingBaseUrl: string;
  deepgramModel: string;
  deepgramLanguageHint: string;
  deepgramEotThreshold: number;
  deepgramEotTimeoutMs: number;
}

function requiredEnvironment(name: string, environment: NodeJS.ProcessEnv): string {
  const value = environment[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function readApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  return apiConfigSchema.parse({
    appDomain: requiredEnvironment('APP_DOMAIN', environment),
    mistralApiKey: requiredEnvironment('MISTRAL_API_KEY', environment),
    mistralApiBaseUrl: requiredEnvironment('MISTRAL_API_BASE_URL', environment),
    mistralContextModel: requiredEnvironment('MISTRAL_CONTEXT_MODEL', environment),
    mistralCommentModel: requiredEnvironment('MISTRAL_COMMENT_MODEL', environment),
    deepgramApiKey: requiredEnvironment('DEEPGRAM_API_KEY', environment),
    deepgramStreamingBaseUrl: requiredEnvironment('DEEPGRAM_STREAMING_BASE_URL', environment),
    deepgramModel: requiredEnvironment('DEEPGRAM_MODEL', environment),
    deepgramLanguageHint: requiredEnvironment('DEEPGRAM_LANGUAGE_HINT', environment),
    deepgramEotThreshold: requiredEnvironment('DEEPGRAM_EOT_THRESHOLD', environment),
    deepgramEotTimeoutMs: requiredEnvironment('DEEPGRAM_EOT_TIMEOUT_MS', environment),
  });
}

export interface ModelCapabilities {
  vision: boolean;
  contextAnalysis: boolean;
  commentGeneration: boolean;
  structuredOutputMode: 'json-schema' | 'unsupported';
}

export function validateModelCapabilities(capabilities: ModelCapabilities): void {
  if (!capabilities.vision) throw new Error('Configured context model does not accept image input');
  if (!capabilities.contextAnalysis) throw new Error('Configured context model is unavailable');
  if (!capabilities.commentGeneration) throw new Error('Configured comment model is unavailable');
  if (capabilities.structuredOutputMode !== 'json-schema')
    throw new Error('Configured models do not support JSON Schema output');
}

const httpsUrlSchema = z
  .url()
  .max(300)
  .refine((value) => new URL(value).protocol === 'https:', 'HTTPS URL is required');

export const apiConfigSchema = z
  .object({
    appDomain: z.hostname(),
    mistralApiKey: z.string().min(16).max(500),
    mistralApiBaseUrl: httpsUrlSchema,
    mistralContextModel: z.string().min(1).max(160),
    mistralCommentModel: z.string().min(1).max(160),
    deepgramApiKey: z.string().min(16).max(500),
    deepgramStreamingBaseUrl: z
      .url()
      .max(300)
      .refine((value) => new URL(value).protocol === 'wss:', 'WSS URL is required'),
    deepgramModel: z.string().min(1).max(160),
    deepgramLanguageHint: z
      .string()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/),
    deepgramEotThreshold: z.coerce.number().min(0.5).max(0.9),
    deepgramEotTimeoutMs: z.coerce.number().int().min(500).max(10_000),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.mistralContextModel === config.mistralCommentModel)
      context.addIssue({
        code: 'custom',
        path: ['mistralCommentModel'],
        message: 'Context and comment models must be configured independently.',
      });
  });
