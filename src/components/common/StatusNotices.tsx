import { useOnlineStatus } from '@/shared/hooks/useOnlineStatus';

interface StatusNoticesProps {
  needRefresh: boolean;
  offlineReady: boolean;
  updateBlocked: boolean;
  onUpdate(): void;
  onDismissOffline(): void;
}

export function StatusNotices({
  needRefresh,
  offlineReady,
  updateBlocked,
  onUpdate,
  onDismissOffline,
}: StatusNoticesProps) {
  const online = useOnlineStatus();
  return (
    <div className="status-notices" aria-live="polite">
      {!online && (
        <div className="status-toast">
          <span className="offline-dot" />
          <div>
            <strong>Офлайн-режим</strong>
            <p>Эфир и локальные данные доступны без сети.</p>
          </div>
        </div>
      )}
      {offlineReady && (
        <div className="status-toast">
          <div>
            <strong>Готово к офлайн-работе</strong>
            <p>App shell сохранён на устройстве.</p>
          </div>
          <button onClick={onDismissOffline}>Ок</button>
        </div>
      )}
      {needRefresh && (
        <div className="status-toast">
          <div>
            <strong>Доступна новая версия</strong>
            <p>
              {updateBlocked
                ? 'Обновление можно применить после остановки сессии.'
                : 'Обновить приложение сейчас?'}
            </p>
          </div>
          <button disabled={updateBlocked} onClick={onUpdate}>
            Обновить
          </button>
        </div>
      )}
    </div>
  );
}
