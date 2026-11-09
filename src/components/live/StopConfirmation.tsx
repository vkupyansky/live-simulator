import { useEffect, useRef } from 'react';

export function StopConfirmation({ onCancel, onConfirm }: { onCancel(): void; onConfirm(): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="stop-confirm-backdrop" role="presentation">
      <section
        className="stop-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="stop-confirm-title"
        aria-describedby="stop-confirm-description"
      >
        <h2 id="stop-confirm-title">Остановить эфир?</h2>
        <p id="stop-confirm-description">Трансляция завершится, камера и микрофон отключатся.</p>
        <div className="stop-confirm-actions">
          <button ref={cancelRef} className="secondary" onClick={onCancel}>
            Отмена
          </button>
          <button className="danger" onClick={onConfirm}>
            Остановить эфир
          </button>
        </div>
      </section>
    </div>
  );
}
