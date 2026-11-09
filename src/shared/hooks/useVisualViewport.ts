import { useEffect, useState } from 'react';

const KEYBOARD_THRESHOLD_PX = 100;

export interface VisualViewportState {
  height: number;
  keyboardOffset: number;
  keyboardOpen: boolean;
}

function readVisualViewport(): VisualViewportState {
  const viewport = window.visualViewport;
  const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
  const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);
  const keyboardOffset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));
  return {
    height,
    keyboardOffset,
    keyboardOpen: keyboardOffset >= KEYBOARD_THRESHOLD_PX,
  };
}

function sameViewport(left: VisualViewportState, right: VisualViewportState): boolean {
  return (
    left.height === right.height &&
    left.keyboardOffset === right.keyboardOffset &&
    left.keyboardOpen === right.keyboardOpen
  );
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => readVisualViewport());

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const previousHeight = root.style.getPropertyValue('--visual-viewport-height');
    const previousOffset = root.style.getPropertyValue('--keyboard-offset');
    let active = true;

    const update = () => {
      if (!active) return;
      const next = readVisualViewport();
      root.style.setProperty('--visual-viewport-height', `${next.height}px`);
      root.style.setProperty('--keyboard-offset', `${next.keyboardOffset}px`);
      setState((current) => (sameViewport(current, next) ? current : next));
    };

    update();
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    window.addEventListener('resize', update);

    return () => {
      active = false;
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (previousHeight) root.style.setProperty('--visual-viewport-height', previousHeight);
      else root.style.removeProperty('--visual-viewport-height');
      if (previousOffset) root.style.setProperty('--keyboard-offset', previousOffset);
      else root.style.removeProperty('--keyboard-offset');
    };
  }, []);

  return state;
}
