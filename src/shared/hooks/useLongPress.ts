import { useCallback, useEffect, useRef, type PointerEventHandler } from 'react';

export function useLongPress(callback: () => void, duration = 600) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);
  const onPointerDown: PointerEventHandler = useCallback(() => {
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      callbackRef.current();
    }, duration);
  }, [clear, duration]);
  return { onPointerDown, onPointerUp: clear, onPointerCancel: clear, onPointerLeave: clear };
}
