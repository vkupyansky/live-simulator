import { z } from 'zod';
import {
  BROADCAST_SCHEMA_VERSION,
  BROADCAST_SETTINGS_KEY,
  MAX_TARGET_VIEWERS,
  MIN_TARGET_VIEWERS,
  type BroadcastSettings,
} from '@/shared/types/broadcast';

const unicodeLength = (value: string) => Array.from(value).length;

export const displayNameSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => unicodeLength(value) >= 1, 'Введите имя ведущего')
  .refine((value) => unicodeLength(value) <= 30, 'Не больше 30 символов');

export const usernameSchema = z
  .string()
  .transform((value) => value.trim().replace(/^@+/, ''))
  .pipe(
    z
      .string()
      .min(3, 'Минимум 3 символа')
      .max(24, 'Не больше 24 символов')
      .regex(/^[A-Za-z0-9._]+$/, 'Только латиница, цифры, точка и подчёркивание'),
  );

export const targetViewersSchema = z
  .number()
  .int('Введите целое число')
  .min(MIN_TARGET_VIEWERS, `Минимум ${MIN_TARGET_VIEWERS}`)
  .max(MAX_TARGET_VIEWERS, `Максимум ${MAX_TARGET_VIEWERS}`);

export const broadcastSettingsSchema = z
  .object({
    key: z.literal(BROADCAST_SETTINGS_KEY),
    schemaVersion: z.literal(BROADCAST_SCHEMA_VERSION),
    avatarBlobId: z.string().min(1).max(100),
    displayName: displayNameSchema,
    username: usernameSchema,
    source: z.discriminatedUnion('type', [
      z.object({ type: z.literal('camera') }).strict(),
      z.object({ type: z.literal('video'), mediaBlobId: z.string().min(1).max(100) }).strict(),
    ]),
    targetViewers: targetViewersSchema,
    activity: z.enum(['low', 'normal', 'high']),
    speechAnalysisEnabled: z.boolean(),
  })
  .strict();

export function validateBroadcastSettings(value: unknown): BroadcastSettings {
  return broadcastSettingsSchema.parse(value);
}
