import { useCallback, useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function usePwa(activeSession: boolean) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [installed] = useState(isStandalone);
  const updateServiceWorker = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (window.isSecureContext === false || !('serviceWorker' in navigator)) return;
    updateServiceWorker.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedRefresh(true),
      onOfflineReady: () => setOfflineReady(true),
    });
  }, []);

  const applyUpdate = useCallback(async () => {
    if (activeSession || !updateServiceWorker.current) return;
    await updateServiceWorker.current(true);
  }, [activeSession]);

  return {
    needRefresh,
    offlineReady,
    installed,
    updateBlockedBySession: needRefresh && activeSession,
    applyUpdate,
    dismissOfflineReady: () => setOfflineReady(false),
  };
}
