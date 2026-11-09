import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useVisualViewport } from '@/shared/hooks/useVisualViewport';

class MockVisualViewport extends EventTarget {
  height = 900;
  width = 430;
  offsetLeft = 0;
  offsetTop = 0;
  pageLeft = 0;
  pageTop = 0;
  scale = 1;
}

describe('useVisualViewport', () => {
  it('registers once, updates viewport and keyboard state, then removes listeners', () => {
    const viewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const heightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    const viewport = new MockVisualViewport();
    const add = vi.spyOn(viewport, 'addEventListener');
    const remove = vi.spyOn(viewport, 'removeEventListener');
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: viewport as unknown as VisualViewport,
    });

    const { result, rerender, unmount } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: 900, keyboardOffset: 0, keyboardOpen: false });
    expect(add).toHaveBeenCalledTimes(2);
    rerender();
    expect(add).toHaveBeenCalledTimes(2);

    act(() => {
      viewport.height = 520;
      viewport.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toEqual({ height: 520, keyboardOffset: 380, keyboardOpen: true });
    expect(document.documentElement.style.getPropertyValue('--visual-viewport-height')).toBe(
      '520px',
    );
    expect(document.documentElement.style.getPropertyValue('--keyboard-offset')).toBe('380px');

    act(() => {
      viewport.offsetTop = 20;
      viewport.dispatchEvent(new Event('scroll'));
    });
    expect(result.current).toEqual({ height: 520, keyboardOffset: 360, keyboardOpen: true });

    unmount();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(document.documentElement.style.getPropertyValue('--visual-viewport-height')).toBe('');
    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--visual-viewport-height')).toBe('');

    if (viewportDescriptor) Object.defineProperty(window, 'visualViewport', viewportDescriptor);
    else Reflect.deleteProperty(window, 'visualViewport');
    if (heightDescriptor) Object.defineProperty(window, 'innerHeight', heightDescriptor);
  });
});
