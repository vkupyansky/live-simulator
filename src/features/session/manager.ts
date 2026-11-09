import { db, materializeStoredBlob, saveBroadcastSettings } from '@/db/database';
import { AiCommentPipeline } from '@/features/ai/pipeline';
import { calculateCommentsPerMinute } from '@/features/audience/model';
import { createAudienceRoster } from '@/features/comments/audience';
import { ConversationDirector } from '@/features/comments/director';
import { CommentScheduler } from '@/features/comments/scheduler';
import { LikeEngine } from '@/features/likes/engine';
import { ObjectUrlRegistry, stopMediaStream } from '@/features/media/resources';
import { reactionIntensity } from '@/features/reactions/engine';
import { SessionStateMachine, type SessionIdentity } from '@/features/session/lifecycle';
import { useSessionStore } from '@/features/session/store';
import { SpeechPipeline } from '@/features/speech/pipeline';
import { ViewerEngine } from '@/features/viewers/engine';
import { logger } from '@/shared/lib/logger';
import type { BroadcastSettings, RuntimeBroadcast } from '@/shared/types/broadcast';

const ENGINE_TICK_MS = 1_000;

interface SessionRuntime {
  identity: SessionIdentity;
  urls: ObjectUrlRegistry;
  videoStream: MediaStream | null;
  audioStream: MediaStream | null;
  scheduler: CommentScheduler;
  aiPipeline: AiCommentPipeline;
  speechPipeline: SpeechPipeline | null;
  videoElement: HTMLVideoElement | null;
  timer: ReturnType<typeof setInterval>;
  visibilityListener: () => void;
}

function cameraError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return new Error('Доступ к камере запрещён. Разрешите камеру в настройках браузера.');
    if (error.name === 'NotFoundError') return new Error('Камера не найдена.');
    if (error.name === 'NotReadableError') return new Error('Камера занята другим приложением.');
  }
  return new Error('Не удалось запустить камеру.');
}

function microphoneError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return 'Микрофон запрещён — эфир продолжен без анализа речи.';
  return 'Речь временно не анализируется — эфир продолжен.';
}

class SessionManager {
  private runtime: SessionRuntime | null = null;
  private readonly machine = new SessionStateMachine({
    onTransition: (snapshot) => useSessionStore.getState().setStatus(snapshot.status),
  });

  async start(settings: BroadcastSettings): Promise<void> {
    if (this.machine.snapshot().status === 'error') this.machine.recover();
    const snapshot = await this.machine.start((identity) => this.prepare(settings, identity));
    if (snapshot.status === 'error') throw new Error(snapshot.error);
    if (snapshot.status === 'active' && this.runtime) {
      this.runtime.scheduler.start();
      this.runtime.speechPipeline?.start();
      this.runtime.aiPipeline.start();
    }
  }

  private async prepare(settings: BroadcastSettings, identity: SessionIdentity): Promise<void> {
    if (this.runtime) return;
    if (
      !navigator.mediaDevices?.getUserMedia &&
      (settings.source.type === 'camera' || settings.speechAnalysisEnabled)
    )
      throw new Error('Браузер не поддерживает доступ к камере или микрофону.');

    let pendingVideoStream: MediaStream | null = null;
    let pendingAudioStream: MediaStream | null = null;
    const stopPendingMedia = () => {
      stopMediaStream(pendingVideoStream);
      stopMediaStream(pendingAudioStream);
      pendingVideoStream = null;
      pendingAudioStream = null;
    };
    identity.signal.addEventListener('abort', stopPendingMedia, { once: true });

    const videoPromise =
      settings.source.type === 'camera'
        ? navigator.mediaDevices
            .getUserMedia({
              video: {
                facingMode: { ideal: 'user' },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
              },
              audio: false,
            })
            .then((stream) => {
              pendingVideoStream = stream;
              if (identity.signal.aborted) {
                stopMediaStream(stream);
                pendingVideoStream = null;
              }
              return { stream, error: null as Error | null };
            })
            .catch((error: unknown) => ({ stream: null, error: cameraError(error) }))
        : Promise.resolve({ stream: null, error: null as Error | null });
    const audioPromise = settings.speechAnalysisEnabled
      ? navigator.mediaDevices
          .getUserMedia({
            video: false,
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
              channelCount: 1,
            },
          })
          .then((stream) => {
            pendingAudioStream = stream;
            if (identity.signal.aborted) {
              stopMediaStream(stream);
              pendingAudioStream = null;
            }
            return { stream, error: '' };
          })
          .catch((error: unknown) => ({ stream: null, error: microphoneError(error) }))
      : Promise.resolve({ stream: null, error: '' });

    const urls = new ObjectUrlRegistry();
    let videoStream: MediaStream | null = null;
    let audioStream: MediaStream | null = null;
    try {
      await saveBroadcastSettings(settings);
      const avatar = await db.blobs.get(settings.avatarBlobId);
      if (!avatar || avatar.kind !== 'avatar')
        throw new Error('Аватар не найден. Выберите его заново.');
      const avatarUrl = urls.create(materializeStoredBlob(avatar));
      let media: RuntimeBroadcast['media'];
      let mediaSrc = '';
      if (settings.source.type === 'video') {
        const video = await db.blobs.get(settings.source.mediaBlobId);
        if (!video || video.kind !== 'video')
          throw new Error('Видео не найдено. Выберите файл заново.');
        mediaSrc = urls.create(materializeStoredBlob(video));
        media = {
          kind: 'file',
        };
      } else {
        media = { kind: 'camera' };
      }

      const [videoResult, audioResult] = await Promise.all([videoPromise, audioPromise]);
      if (videoResult.error) throw videoResult.error;
      videoStream = videoResult.stream;
      audioStream = audioResult.stream;
      pendingVideoStream = null;
      pendingAudioStream = null;
      if (identity.signal.aborted) throw new DOMException('Сессия остановлена', 'AbortError');

      const broadcast: RuntimeBroadcast = {
        sessionId: identity.sessionId,
        seed: identity.seed,
        displayName: settings.displayName,
        username: settings.username,
        avatarDataUrl: avatarUrl,
        media,
        targetViewers: settings.targetViewers,
        activity: settings.activity,
        speechAnalysisEnabled: settings.speechAnalysisEnabled,
      };
      const viewerEngine = new ViewerEngine({
        targetViewers: settings.targetViewers,
        activity: settings.activity,
        seed: identity.seed,
        now: identity.startedAt,
      });
      const viewerState = viewerEngine.snapshot();
      const likeEngine = new LikeEngine(
        settings.activity,
        identity.seed,
        identity.startedAt,
        viewerState.displayValue,
      );
      const roster = createAudienceRoster(settings.targetViewers, identity.seed);
      const director = new ConversationDirector(identity.seed, roster);
      let currentCommentsPerMinute = calculateCommentsPerMinute(
        viewerState.displayValue,
        settings.activity,
      );
      let aiPipeline: AiCommentPipeline | null = null;
      const scheduler = new CommentScheduler({
        seed: identity.seed,
        roster,
        getCommentsPerMinute: () => currentCommentsPerMinute,
        onComment: (comment) => {
          if (this.machine.isCurrent(identity.sessionId))
            useSessionStore.getState().addComment(comment);
        },
        onLowBuffer: () => aiPipeline?.requestSoon(),
        onBufferChanged: (remaining, rendered) => aiPipeline?.bufferChanged(remaining, rendered),
        onRendered: (comment) => director.recordRendered(comment, performance.now()),
      });
      aiPipeline = new AiCommentPipeline({
        broadcast,
        roster,
        scheduler,
        director,
        signal: identity.signal,
        getViewers: () => useSessionStore.getState().viewers,
        getCommentsPerMinute: () => currentCommentsPerMinute,
        getRecentComments: () => useSessionStore.getState().comments,
        getTranscript: () => this.runtime?.speechPipeline?.transcript.snapshot() ?? [],
        isCurrent: () => this.machine.isCurrent(identity.sessionId),
        onStatus: (status) => {
          useSessionStore.getState().setCommentPipelineStatus(status);
        },
      });

      const speechPipeline = audioStream
        ? new SpeechPipeline({
            sessionId: identity.sessionId,
            stream: audioStream,
            signal: identity.signal,
            isCurrent: () => this.machine.isCurrent(identity.sessionId),
            onTranscriptChanged: () => aiPipeline?.transcriptChanged(),
            onStatus: (status) => {
              useSessionStore.getState().setSpeechStatus(status);
            },
          })
        : null;

      useSessionStore
        .getState()
        .activate(
          broadcast,
          { src: mediaSrc, stream: videoStream },
          viewerState.displayValue,
          likeEngine.snapshot(),
        );
      if (audioResult.error) {
        useSessionStore.getState().setSpeechStatus('error');
      }

      const timer = setInterval(() => {
        if (document.hidden || !this.machine.isCurrent(identity.sessionId)) return;
        const now = performance.now();
        const nextViewers = viewerEngine.tick(now);
        currentCommentsPerMinute = calculateCommentsPerMinute(
          nextViewers.displayValue,
          settings.activity,
        );
        const likes = likeEngine.tick({
          now,
          currentViewers: nextViewers.displayValue,
          viewerEventFactor: nextViewers.eventFactor,
          commentsPerMinute: currentCommentsPerMinute,
        });
        const store = useSessionStore.getState();
        store.setViewers(nextViewers.displayValue);
        store.setLikes(likes.value);
        store.setReactionIntensity(
          reactionIntensity({
            currentViewers: nextViewers.displayValue,
            activity: settings.activity,
            viewerEventFactor: nextViewers.eventFactor,
            commentsPerMinute: currentCommentsPerMinute,
            likeBurst: likes.burst,
          }),
        );
      }, ENGINE_TICK_MS);
      const visibilityListener = () => {
        if (document.hidden) {
          speechPipeline?.pause();
        } else {
          speechPipeline?.resume();
        }
      };
      document.addEventListener('visibilitychange', visibilityListener);
      identity.signal.removeEventListener('abort', stopPendingMedia);
      this.runtime = {
        identity,
        urls,
        videoStream,
        audioStream,
        scheduler,
        aiPipeline,
        speechPipeline,
        videoElement: null,
        timer,
        visibilityListener,
      };
    } catch (error) {
      identity.signal.removeEventListener('abort', stopPendingMedia);
      stopPendingMedia();
      // getUserMedia cannot be cancelled. Release a stream whenever a still-pending
      // permission request eventually settles, without keeping session cleanup waiting.
      void videoPromise.then((result) => stopMediaStream(result.stream));
      void audioPromise.then((result) => stopMediaStream(result.stream));
      stopMediaStream(videoStream);
      stopMediaStream(audioStream);
      urls.revokeAll();
      if (this.machine.isCurrent(identity.sessionId)) useSessionStore.getState().clear();
      throw error;
    }
  }

  attachVideo(video: HTMLVideoElement): void {
    if (!this.runtime) return;
    this.runtime.videoElement = video;
    this.runtime.aiPipeline.attachVideo(video);
  }

  resumeAfterStopCancel(): void {
    const video = this.runtime?.videoElement;
    if (video?.paused) void video.play().catch(() => undefined);
  }

  async stop(): Promise<void> {
    await this.machine.stop(async () => {
      const runtime = this.runtime;
      this.runtime = null;
      if (!runtime) {
        useSessionStore.getState().clear();
        return;
      }
      clearInterval(runtime.timer);
      document.removeEventListener('visibilitychange', runtime.visibilityListener);
      runtime.scheduler.stop();
      runtime.aiPipeline.stop();
      runtime.videoElement?.pause();
      if (runtime.videoElement) runtime.videoElement.srcObject = null;
      stopMediaStream(runtime.videoStream);
      stopMediaStream(runtime.audioStream);
      runtime.urls.revokeAll();
      useSessionStore.getState().clear();
      if (runtime.speechPipeline)
        try {
          await runtime.speechPipeline.stop();
        } catch {
          logger.warn('speech_cleanup_failed');
        }
    });
  }

  bindPageLifecycle(): () => void {
    const pause = () => {
      this.runtime?.aiPipeline.pause('hidden');
      this.runtime?.speechPipeline?.pause();
      this.runtime?.videoElement?.pause();
    };
    const resume = () => {
      this.runtime?.aiPipeline.resume('hidden');
      this.runtime?.speechPipeline?.resume();
      const video = this.runtime?.videoElement;
      if (video?.paused) void video.play().catch(() => undefined);
    };
    window.addEventListener('pagehide', pause);
    window.addEventListener('pageshow', resume);
    document.addEventListener('freeze', pause);
    document.addEventListener('resume', resume);
    return () => {
      window.removeEventListener('pagehide', pause);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('freeze', pause);
      document.removeEventListener('resume', resume);
    };
  }

  get status() {
    return this.machine.snapshot().status;
  }
}

export const sessionManager = new SessionManager();
