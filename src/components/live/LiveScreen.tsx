import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Avatar } from '@/components/common/Avatar';
import {
  HeartIcon,
  LiveLinkIcon,
  MoreIcon,
  PeopleIcon,
  PowerIcon,
  UserIcon,
} from '@/components/common/Icons';
import { CommentFeed } from '@/components/live/CommentFeed';
import { ReactionLayer } from '@/components/live/ReactionLayer';
import { sessionManager } from '@/features/session/manager';
import { useSessionStore } from '@/features/session/store';
import { useLongPress } from '@/shared/hooks/useLongPress';
import { formatCount } from '@/shared/lib/formatCount';
import type { RuntimeBroadcast } from '@/shared/types/broadcast';

const LiveMedia = memo(function LiveMedia({ broadcast }: { broadcast: RuntimeBroadcast }) {
  const media = useSessionStore((state) => state.media);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = media.stream;
    video.muted = true;
    void video.play().catch(() => undefined);
    sessionManager.attachVideo(video);
    const onVisibility = () => {
      media.stream?.getVideoTracks().forEach((track) => {
        track.enabled = !document.hidden;
      });
      if (document.hidden) video.pause();
      else void video.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      video.pause();
      video.srcObject = null;
    };
  }, [media.src, media.stream]);

  return (
    <>
      <video
        ref={videoRef}
        className={`live-video ${broadcast.media.kind === 'camera' ? 'mirrored' : ''}`}
        src={media.src || undefined}
        autoPlay
        playsInline
        muted
        loop={broadcast.media.kind === 'file'}
      />
    </>
  );
});

const HostControl = memo(function HostControl({
  broadcast,
  onSettings,
}: {
  broadcast: RuntimeBroadcast;
  onSettings(): void;
}) {
  const longPress = useLongPress(onSettings);
  return (
    <button className="live-host-control" {...longPress} aria-label="Профиль ведущего">
      <Avatar dataUrl={broadcast.avatarDataUrl} name={broadcast.displayName} size={42} />
      <strong>{broadcast.displayName}</strong>
    </button>
  );
});

const LikesControl = memo(function LikesControl({ onLike }: { onLike(): void }) {
  const likes = useSessionStore((state) => state.likes);
  return (
    <button
      className="live-count-control likes-control"
      onClick={onLike}
      aria-label="Поставить лайк"
    >
      <HeartIcon />
      <span>{formatCount(likes)}</span>
    </button>
  );
});

const ViewerControl = memo(function ViewerControl() {
  const viewers = useSessionStore((state) => state.viewers);
  return (
    <span className="live-count-control viewer-control" aria-label={`Зрителей: ${viewers}`}>
      <UserIcon />
      <span>{formatCount(viewers)}</span>
    </span>
  );
});

const LiveHeader = memo(function LiveHeader({
  broadcast,
  onSettings,
  onStop,
  onLike,
}: {
  broadcast: RuntimeBroadcast;
  onSettings(): void;
  onStop(): void;
  onLike(): void;
}) {
  return (
    <header className="live-top-controls">
      <HostControl broadcast={broadcast} onSettings={onSettings} />
      <LikesControl onLike={onLike} />
      <span className="live-top-spacer" />
      <ViewerControl />
      <button className="live-stop-control" onClick={onStop} aria-label="Остановить эфир">
        <PowerIcon />
      </button>
    </header>
  );
});

export function LiveScreen({
  onSettings,
  onStop,
  settingsButtonRef,
}: {
  onSettings(): void;
  onStop(): void;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const broadcast = useSessionStore((state) => state.activeBroadcast);
  const comments = useSessionStore((state) => state.comments);
  const uiVisible = useSessionStore((state) => state.uiVisible);
  const reactionIntensity = useSessionStore((state) => state.reactionIntensity);
  const toggleUi = useSessionStore((state) => state.toggleUi);
  const [ambientReactionsReady, setAmbientReactionsReady] = useState(false);
  const [manualReactionSignal, setManualReactionSignal] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setAmbientReactionsReady(true), 18_000);
    return () => window.clearTimeout(timer);
  }, []);

  const sendReaction = useCallback(() => {
    const current = useSessionStore.getState().likes;
    useSessionStore.getState().setLikes(current + 1);
    setManualReactionSignal((signal) => signal + 1);
  }, []);

  if (!broadcast) return null;
  return (
    <main className="live-screen">
      <LiveMedia broadcast={broadcast} />
      <div className="video-shade" />
      <button
        className="live-overlay-toggle"
        onClick={toggleUi}
        aria-label={uiVisible ? 'Скрыть интерфейс эфира' : 'Показать интерфейс эфира'}
      />
      <ReactionLayer
        intensity={ambientReactionsReady ? reactionIntensity : 0}
        manualSignal={manualReactionSignal}
        seed={broadcast.seed}
      />
      <div className={`live-ui ${uiVisible ? 'visible' : 'hidden'}`} aria-hidden={!uiVisible}>
        <div>
          <LiveHeader
            broadcast={broadcast}
            onSettings={onSettings}
            onStop={onStop}
            onLike={sendReaction}
          />
        </div>
        <div className="live-content">
          <CommentFeed comments={comments} />
        </div>
        <nav className="live-bottom-controls" aria-label="Управление эфиром">
          <div className="live-decorative-action brand-control" aria-hidden="true">
            <LiveLinkIcon />
          </div>
          <div className="live-decorative-action" aria-hidden="true">
            <PeopleIcon />
          </div>
          <span className="live-bottom-spacer" />
          <button
            ref={settingsButtonRef}
            className="live-action-control"
            onClick={onSettings}
            aria-label="Открыть управление эфиром"
          >
            <MoreIcon />
          </button>
        </nav>
      </div>
    </main>
  );
}
