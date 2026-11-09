import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { StatusNotices } from '@/components/common/StatusNotices';
import { LiveScreen } from '@/components/live/LiveScreen';
import { StopConfirmation } from '@/components/live/StopConfirmation';
import { BroadcastSetup } from '@/components/settings/BroadcastSetup';
import { getBroadcastSettings } from '@/db/database';
import { sessionManager } from '@/features/session/manager';
import { useSessionStore } from '@/features/session/store';
import { usePwa } from '@/pwa/usePwa';
import type { BroadcastSettings } from '@/shared/types/broadcast';

const SettingsPanel = lazy(() => import('@/components/settings/SettingsPanel'));
type StopConfirmationState = 'closed' | 'open';

export function App() {
  const settings = useLiveQuery(() => getBroadcastSettings(), [], null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopConfirmation, setStopConfirmation] = useState<StopConfirmationState>('closed');
  const liveSurfaceRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const stopReturnFocusRef = useRef<HTMLElement | null>(null);
  const status = useSessionStore((state) => state.status);
  const pwa = usePwa(status === 'active' || status === 'preparing');

  useEffect(() => {
    const unbind = sessionManager.bindPageLifecycle();
    return () => {
      unbind();
      void sessionManager.stop();
    };
  }, []);

  useEffect(() => {
    const surface = liveSurfaceRef.current;
    if (!surface) return;
    const covered = settingsOpen || stopConfirmation === 'open';
    surface.inert = covered;
    surface.setAttribute('aria-hidden', covered ? 'true' : 'false');
  }, [settingsOpen, stopConfirmation]);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    window.requestAnimationFrame(() => settingsButtonRef.current?.focus());
  }, []);

  const requestStop = useCallback(() => {
    stopReturnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStopConfirmation('open');
  }, []);

  const cancelStop = useCallback(() => {
    setStopConfirmation('closed');
    sessionManager.resumeAfterStopCancel();
    window.requestAnimationFrame(() => stopReturnFocusRef.current?.focus());
  }, []);

  const confirmStop = useCallback(() => {
    setStopConfirmation('closed');
    void sessionManager.stop();
    setSettingsOpen(false);
  }, []);

  return (
    <>
      {status === 'active' ? (
        <div ref={liveSurfaceRef} className="live-session-surface">
          <LiveScreen
            onSettings={() => setSettingsOpen(true)}
            onStop={requestStop}
            settingsButtonRef={settingsButtonRef}
          />
        </div>
      ) : settings === null ? (
        <main className="broadcast-setup loading-screen">
          <span className="setup-loader" />
        </main>
      ) : (
        <BroadcastSetup
          initial={settings}
          status={status === 'preparing' || status === 'error' ? status : 'idle'}
          onStart={(broadcast: BroadcastSettings) => sessionManager.start(broadcast)}
        />
      )}
      {settingsOpen && status === 'active' && (
        <Suspense fallback={<div className="sheet-loading">Открываю настройки…</div>}>
          <SettingsPanel onClose={closeSettings} onStop={requestStop} />
        </Suspense>
      )}
      {stopConfirmation === 'open' && status === 'active' && (
        <StopConfirmation onCancel={cancelStop} onConfirm={confirmStop} />
      )}
      <StatusNotices
        needRefresh={pwa.needRefresh}
        offlineReady={pwa.offlineReady}
        updateBlocked={pwa.updateBlockedBySession}
        onUpdate={() => void pwa.applyUpdate()}
        onDismissOffline={pwa.dismissOfflineReady}
      />
      <div className="landscape-guard">
        <div className="brand-mark" />
        <h2>Поверните iPhone</h2>
        <p>Live-интерфейс рассчитан на портретную ориентацию.</p>
      </div>
    </>
  );
}
