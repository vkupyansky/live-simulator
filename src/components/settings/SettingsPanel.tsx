import { useEffect, useRef, type MouseEvent } from 'react';
import { CloseIcon } from '@/components/common/Icons';
import { useSessionStore, type CommentPipelineStatus } from '@/features/session/store';

function commentStatusLabel(status: CommentPipelineStatus): string {
  if (status.state === 'paused') return 'Пауза';
  if (status.state === 'backoff' || status.state === 'error') return 'Восстановление';
  if (status.state === 'active' || status.state === 'buffered') return 'Работают';
  if (status.state === 'requesting') return 'Генерация';
  return 'Запуск';
}

export default function SettingsPanel({ onClose, onStop }: { onClose(): void; onStop(): void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const speechStatus = useSessionStore((state) => state.speechStatus);
  const commentStatus = useSessionStore((state) => state.commentPipelineStatus);
  const recovering = commentStatus.state === 'backoff' || commentStatus.state === 'error';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const closeFromBackdrop = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const speechLabel =
    speechStatus === 'off'
      ? 'Выключена'
      : speechStatus === 'error'
        ? 'Ошибка'
        : speechStatus === 'recovering'
          ? 'Восстановление'
          : speechStatus === 'paused'
            ? 'Пауза'
            : 'Включена';

  return (
    <aside
      ref={dialogRef}
      className="control-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="control-sheet-title"
      onMouseDown={closeFromBackdrop}
    >
      <section className="control-sheet">
        <span className="control-sheet-handle" aria-hidden="true" />
        <header className="control-sheet-header">
          <h2 id="control-sheet-title">Управление эфиром</h2>
          <button
            ref={closeButtonRef}
            className="control-sheet-close"
            onClick={onClose}
            aria-label="Закрыть управление эфиром"
          >
            <CloseIcon />
          </button>
        </header>
        <div className="control-sheet-statuses">
          <div className="control-status-row">
            <span>Эфир</span>
            <strong>
              <i className="control-status-dot" />
              Активен
            </strong>
          </div>
          <div className="control-status-row">
            <span>Комментарии</span>
            <strong>{commentStatusLabel(commentStatus)}</strong>
          </div>
          <div className="control-status-row">
            <span>Речь</span>
            <strong>{speechLabel}</strong>
          </div>
        </div>
        {recovering && (
          <p className="comment-recovery-note">Комментарии временно восстанавливаются</p>
        )}
        <button className="control-sheet-stop" onClick={onStop}>
          Остановить эфир
        </button>
      </section>
    </aside>
  );
}
