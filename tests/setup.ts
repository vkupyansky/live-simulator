import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const hasDom = typeof window !== 'undefined' && typeof navigator !== 'undefined';

if (hasDom) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: vi.fn(async () => ({ usage: 0, quota: 2_000_000_000 })) },
  });

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });

  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:test-${crypto.getRandomValues(new Uint32Array(1))[0]}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });

  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
}

beforeEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (hasDom) {
    vi.mocked(navigator.storage.estimate).mockResolvedValue({ usage: 0, quota: 2_000_000_000 });
    vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
      getTracks: () => [],
      getVideoTracks: () => [],
    } as unknown as MediaStream);
  }
});

afterEach(() => {
  if (hasDom) cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
