import { describe, expect, it } from 'vitest';
import {
  broadcastSettingsSchema,
  displayNameSchema,
  usernameSchema,
} from '@/shared/schemas/broadcast';

describe('broadcast singleton validation', () => {
  it('validates Unicode display names and trims them', () => {
    expect(displayNameSchema.parse('  Сара  ')).toBe('Сара');
    expect(() => displayNameSchema.parse('   ')).toThrow('Введите имя');
    expect(() => displayNameSchema.parse('я'.repeat(31))).toThrow('30');
  });

  it('normalizes @ and validates username characters and length', () => {
    expect(usernameSchema.parse('@studio.live')).toBe('studio.live');
    expect(() => usernameSchema.parse('ab')).toThrow('3');
    expect(() => usernameSchema.parse('studio live')).toThrow('латиница');
  });

  it('rejects unknown keys and incomplete hidden selections', () => {
    const base = {
      key: 'broadcast',
      schemaVersion: 5,
      avatarBlobId: 'avatar',
      displayName: 'Host',
      username: 'host.live',
      source: { type: 'camera' },
      targetViewers: 500,
      activity: 'normal',
      speechAnalysisEnabled: false,
    };
    expect(broadcastSettingsSchema.parse(base)).toEqual(base);
    expect(broadcastSettingsSchema.safeParse({ ...base, targetViewers: 37_421 }).success).toBe(
      true,
    );
    expect(broadcastSettingsSchema.safeParse({ ...base, targetViewers: 1_000_000 }).success).toBe(
      false,
    );
    expect(broadcastSettingsSchema.safeParse({ ...base, targetViewers: null }).success).toBe(false);
    expect(broadcastSettingsSchema.safeParse({ ...base, secret: 'unsafe' }).success).toBe(false);
  });
});
