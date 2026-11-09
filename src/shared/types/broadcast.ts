export const BROADCAST_SCHEMA_VERSION = 5 as const;
export const BROADCAST_SETTINGS_KEY = 'broadcast' as const;
export const MAX_VIDEO_BYTES = 350 * 1024 * 1024;
export const MAX_AVATAR_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_RUNTIME_COMMENTS = 100;
export const MIN_TARGET_VIEWERS = 1;
export const MAX_TARGET_VIEWERS = 999_999;

export type TargetViewers = number;
export type ActivityLevel = 'low' | 'normal' | 'high';
export type PersonaBadge = 'active' | 'supporter' | 'newcomer' | null;

export type BroadcastSource = { type: 'camera' } | { type: 'video'; mediaBlobId: string };

export interface BroadcastSettings {
  key: typeof BROADCAST_SETTINGS_KEY;
  schemaVersion: typeof BROADCAST_SCHEMA_VERSION;
  avatarBlobId: string;
  displayName: string;
  username: string;
  source: BroadcastSource;
  targetViewers: TargetViewers;
  activity: ActivityLevel;
  speechAnalysisEnabled: boolean;
}

export interface StoredBlob {
  id: string;
  kind: 'avatar' | 'video';
  blob: Blob | ArrayBuffer;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

export type RuntimeMediaSource = { kind: 'camera' } | { kind: 'file' };

export interface RuntimeBroadcast {
  sessionId: string;
  seed: number;
  displayName: string;
  username: string;
  avatarDataUrl: string;
  media: RuntimeMediaSource;
  targetViewers: TargetViewers;
  activity: ActivityLevel;
  speechAnalysisEnabled: boolean;
}

export interface LiveComment {
  instanceId: string;
  templateId: string;
  author: string;
  avatarSeed: string;
  text: string;
  badge: PersonaBadge;
  pinned: boolean;
  isHost: boolean;
  appearedAt: number;
}

export interface PersonaStyle {
  casing: 'lower' | 'sentence' | 'mixed';
  language: 'ru' | 'en';
  tone: 'casual' | 'supportive' | 'question' | 'slang' | 'emoji' | 'short';
  typoProbability: number;
  emojiProbability: number;
  activityWeight: number;
}

export interface AudiencePersona {
  id: string;
  username: string;
  displayName: string;
  avatarSeed: string;
  primaryLanguage: 'ru' | 'en';
  style: PersonaStyle;
}

export interface TranscriptSegment {
  sequence: number;
  text: string;
  startedAtMs: number;
  endedAtMs: number;
  language?: string;
}
