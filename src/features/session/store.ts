import { create } from 'zustand';
import {
  MAX_RUNTIME_COMMENTS,
  type LiveComment,
  type RuntimeBroadcast,
} from '@/shared/types/broadcast';
import type { SessionStatus } from '@/features/session/lifecycle';

export type CommentPipelineStatus =
  | { state: 'idle' }
  | { state: 'requesting'; sequence: number }
  | { state: 'buffered'; remaining: number }
  | { state: 'active'; remaining: number }
  | { state: 'backoff'; retryAt: number; reason: string }
  | { state: 'paused'; reason: 'hidden' | 'offline' }
  | { state: 'error'; retryable: boolean; code: string };

interface RuntimeMediaState {
  src: string;
  stream: MediaStream | null;
}

interface SessionState {
  status: SessionStatus;
  sessionId: string | null;
  activeBroadcast: RuntimeBroadcast | null;
  media: RuntimeMediaState;
  viewers: number;
  likes: number;
  reactionIntensity: number;
  comments: LiveComment[];
  uiVisible: boolean;
  commentPipelineStatus: CommentPipelineStatus;
  startedAt: number | null;
  speechStatus: 'off' | 'preparing' | 'active' | 'paused' | 'recovering' | 'error';
  setStatus(status: SessionStatus): void;
  activate(
    broadcast: RuntimeBroadcast,
    media: RuntimeMediaState,
    viewers: number,
    likes: number,
  ): void;
  clear(): void;
  setViewers(viewers: number): void;
  setLikes(likes: number): void;
  setReactionIntensity(intensity: number): void;
  addComment(comment: LiveComment): void;
  toggleUi(): void;
  setCommentPipelineStatus(status: CommentPipelineStatus): void;
  setSpeechStatus(status: SessionState['speechStatus']): void;
}

const EMPTY_MEDIA: RuntimeMediaState = {
  src: '',
  stream: null,
};

export const useSessionStore = create<SessionState>((set) => ({
  status: 'idle',
  sessionId: null,
  activeBroadcast: null,
  media: EMPTY_MEDIA,
  viewers: 0,
  likes: 0,
  reactionIntensity: 0,
  comments: [],
  uiVisible: true,
  commentPipelineStatus: { state: 'idle' },
  startedAt: null,
  speechStatus: 'off',
  setStatus(status) {
    set({ status });
  },
  activate(activeBroadcast, media, viewers, likes) {
    set({
      status: 'active',
      sessionId: activeBroadcast.sessionId,
      activeBroadcast,
      media,
      viewers: Math.round(viewers),
      likes: Math.round(likes),
      reactionIntensity: 0,
      comments: [],
      uiVisible: true,
      commentPipelineStatus: { state: 'idle' },
      startedAt: performance.now(),
      speechStatus: activeBroadcast.speechAnalysisEnabled ? 'preparing' : 'off',
    });
  },
  clear() {
    set({
      status: 'idle',
      sessionId: null,
      activeBroadcast: null,
      media: EMPTY_MEDIA,
      viewers: 0,
      likes: 0,
      reactionIntensity: 0,
      comments: [],
      uiVisible: true,
      commentPipelineStatus: { state: 'idle' },
      startedAt: null,
      speechStatus: 'off',
    });
  },
  setViewers(viewers) {
    set({ viewers: Math.max(0, Math.round(viewers)) });
  },
  setLikes(likes) {
    set((state) => ({ likes: Math.max(state.likes, Math.round(likes)) }));
  },
  setReactionIntensity(reactionIntensity) {
    set({ reactionIntensity });
  },
  addComment(comment) {
    set((state) => {
      const comments = state.comments.slice(
        Math.max(0, state.comments.length - MAX_RUNTIME_COMMENTS + 1),
      );
      comments.push(comment);
      return { comments };
    });
  },
  toggleUi() {
    set((state) => ({ uiVisible: !state.uiVisible }));
  },
  setCommentPipelineStatus(commentPipelineStatus) {
    set({ commentPipelineStatus });
  },
  setSpeechStatus(speechStatus) {
    set({ speechStatus });
  },
}));
