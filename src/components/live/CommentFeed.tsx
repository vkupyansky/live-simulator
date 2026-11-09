import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { PersonaAvatar } from '@/components/live/PersonaAvatar';
import { PersonaBadge } from '@/components/live/PersonaBadge';
import { MAX_RUNTIME_COMMENTS, type LiveComment } from '@/shared/types/broadcast';

const CommentItem = memo(function CommentItem({ comment }: { comment: LiveComment }) {
  return (
    <div className="live-comment">
      <PersonaAvatar seed={comment.avatarSeed} />
      <p>
        <strong>
          <span>{comment.author}</span>
          <PersonaBadge badge={comment.badge} />
        </strong>
        <span className="live-comment-text">{comment.text}</span>
      </p>
    </div>
  );
});

export const CommentFeed = memo(function CommentFeed({ comments }: { comments: LiveComment[] }) {
  const { pinned, visibleComments } = useMemo(() => {
    let latestPinned: LiveComment | undefined;
    const visible: LiveComment[] = [];
    for (const comment of comments) {
      if (comment.pinned) latestPinned = comment;
      else visible.push(comment);
    }
    if (visible.length > MAX_RUNTIME_COMMENTS)
      visible.splice(0, visible.length - MAX_RUNTIME_COMMENTS);
    return { pinned: latestPinned, visibleComments: visible };
  }, [comments]);
  const feedRef = useRef<HTMLDivElement>(null);
  const stickToLatest = useRef(true);

  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (feed && stickToLatest.current && feed.scrollHeight > feed.clientHeight + 1)
      feed.scrollTop = feed.scrollHeight;
  }, [comments.length]);

  const trackScrollPosition = () => {
    const feed = feedRef.current;
    if (!feed) return;
    stickToLatest.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 28;
  };

  return (
    <div className="comments-wrap" aria-live="polite">
      {pinned && (
        <div className="pinned-comment">
          <span>Закреплено</span>
          <strong>{pinned.author}</strong> {pinned.text}
        </div>
      )}
      <div
        ref={feedRef}
        className="comment-feed"
        onScroll={trackScrollPosition}
        aria-label="Последние комментарии"
      >
        {visibleComments.map((comment) => (
          <CommentItem comment={comment} key={comment.instanceId} />
        ))}
      </div>
    </div>
  );
});
