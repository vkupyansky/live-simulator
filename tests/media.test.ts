import { describe, expect, it, vi } from 'vitest';
import { SpeechPipeline } from '@/features/speech/pipeline';
import { TranscriptWindow, normalizeTranscript } from '@/features/speech/transcript';
import {
  FRAME_MAX_BYTES,
  calculateFrameDimensions,
  captureVideoFrame,
  measureFrameQuality,
  normalizedSceneDifference,
  normalizedSceneRmsDifference,
} from '@/features/vision/frame';

describe('frame and speech domain services', () => {
  it('resizes portrait and landscape frames inside the hard bounds', () => {
    expect(calculateFrameDimensions(1080, 1920)).toEqual({ width: 576, height: 1024 });
    expect(calculateFrameDimensions(1920, 1080)).toEqual({ width: 576, height: 324 });
    expect(calculateFrameDimensions(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it('detects scene changes with normalized grayscale differences', () => {
    expect(normalizedSceneDifference(new Uint8Array([10, 10]), new Uint8Array([10, 10]))).toBe(0);
    expect(normalizedSceneDifference(new Uint8Array([0, 0]), new Uint8Array([255, 255]))).toBe(1);
  });

  it('detects a localized foreground change without reacting to low sensor noise', () => {
    const baseline = new Uint8Array(18 * 32).fill(32);
    const withForegroundObject = baseline.slice();
    withForegroundObject.fill(180, 0, 32);
    const sensorNoise = new Uint8Array(18 * 32).fill(38);

    expect(normalizedSceneDifference(baseline, withForegroundObject)).toBeLessThan(0.04);
    expect(normalizedSceneRmsDifference(baseline, withForegroundObject)).toBeGreaterThan(0.115);
    expect(normalizedSceneRmsDifference(baseline, sensorNoise)).toBeLessThan(0.03);
  });

  it('summarizes frame exposure without retaining image pixels', () => {
    const signature = new Uint8Array([0, 8, 32, 64, 128, 255]);
    const quality = measureFrameQuality(signature);

    expect(quality.meanLuminance).toBeCloseTo(81.166 / 255, 3);
    expect(quality.luminanceDeviation).toBeGreaterThan(0);
    expect(quality.darkPixelRatio).toBe(0.5);
    expect(quality.clippedBlackRatio).toBe(2 / 6);
    expect(measureFrameQuality(new Uint8Array())).toEqual({
      meanLuminance: 0,
      luminanceDeviation: 0,
      darkPixelRatio: 1,
      clippedBlackRatio: 1,
    });
  });

  it('compresses a captured JPEG below the byte limit and releases canvas memory', async () => {
    const signatureContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(18 * 32 * 4).fill(90) })),
      clearRect: vi.fn(),
    };
    const outputContext = { drawImage: vi.fn(), clearRect: vi.fn() };
    let attempts = 0;
    const signatureCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => signatureContext),
    };
    const outputCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => outputContext),
      toBlob: vi.fn((callback: BlobCallback) => {
        attempts += 1;
        const size = attempts === 1 ? FRAME_MAX_BYTES + 20_000 : FRAME_MAX_BYTES - 1_000;
        callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
      }),
    };
    const canvases = [signatureCanvas, outputCanvas];
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') return canvases.shift() as unknown as HTMLCanvasElement;
      return document.createElement(tagName);
    }) as typeof document.createElement);
    const frame = await captureVideoFrame(
      {
        readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
        videoWidth: 1080,
        videoHeight: 1920,
      } as HTMLVideoElement,
      null,
      true,
    );
    expect(frame?.size).toBeLessThanOrEqual(FRAME_MAX_BYTES);
    expect(frame?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(frame?.quality.meanLuminance).toBeCloseTo(0.3529, 3);
    expect(attempts).toBe(2);
    expect(outputCanvas.width).toBe(1);
    expect(outputCanvas.height).toBe(1);
  });

  it('releases a full-size canvas when JPEG encoding fails', async () => {
    const signatureContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(18 * 32 * 4).fill(90) })),
      clearRect: vi.fn(),
    };
    const outputContext = { drawImage: vi.fn(), clearRect: vi.fn() };
    const signatureCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => signatureContext),
    };
    const outputCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => outputContext),
      toBlob: vi.fn((callback: BlobCallback) => callback(null)),
    };
    const canvases = [signatureCanvas, outputCanvas];
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') return canvases.shift() as unknown as HTMLCanvasElement;
      return document.createElement(tagName);
    }) as typeof document.createElement);

    await expect(
      captureVideoFrame(
        {
          readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
          videoWidth: 1080,
          videoHeight: 1920,
        } as HTMLVideoElement,
        null,
        true,
      ),
    ).rejects.toThrow('Не удалось подготовить кадр.');
    expect(outputCanvas.width).toBe(1);
    expect(outputCanvas.height).toBe(1);
    expect(outputContext.clearRect).toHaveBeenCalledOnce();
  });

  it('refreshes a forced frame without reporting an unchanged scene as changed', async () => {
    const grayscale = new Uint8ClampedArray(18 * 32 * 4).fill(90);
    const signatureContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: grayscale })),
      clearRect: vi.fn(),
    };
    const outputContext = { drawImage: vi.fn(), clearRect: vi.fn() };
    const signatureCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => signatureContext),
    };
    const outputCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => outputContext),
      toBlob: vi.fn((callback: BlobCallback) => {
        callback(new Blob([new Uint8Array(1_024)], { type: 'image/jpeg' }));
      }),
    };
    const canvases = [signatureCanvas, outputCanvas];
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      if (tagName === 'canvas') return canvases.shift() as unknown as HTMLCanvasElement;
      return document.createElement(tagName);
    }) as typeof document.createElement);

    const frame = await captureVideoFrame(
      {
        readyState: HTMLMediaElement.HAVE_CURRENT_DATA,
        videoWidth: 430,
        videoHeight: 932,
      } as HTMLVideoElement,
      new Uint8Array(18 * 32).fill(90),
      true,
    );

    expect(frame).toMatchObject({ sceneChanged: false, size: 1_024 });
    expect(frame?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(outputContext.drawImage).toHaveBeenCalledOnce();
  });

  it('normalizes, bounds and clears rolling transcripts', () => {
    expect(normalizeTranscript('  привет   всем  ')).toBe('привет всем');
    expect(normalizeTranscript('[noise]')).toBe('');
    const rolling = new TranscriptWindow();
    for (let sequence = 0; sequence < 30; sequence += 1)
      rolling.add(
        {
          sequence,
          text: `сегмент ${sequence}`,
          startedAtMs: sequence * 5_000,
          endedAtMs: sequence * 5_000 + 4_000,
        },
        sequence * 5_000 + 4_000,
      );
    expect(rolling.snapshot().length).toBeLessThanOrEqual(18);
    expect(rolling.snapshot()[0]?.endedAtMs).toBeGreaterThanOrEqual(59_000);
    rolling.clear();
    expect(rolling.snapshot()).toEqual([]);
  });

  it('disconnects AudioWorklet graph, socket and microphone tracks', async () => {
    const sourceDisconnect = vi.fn();
    const processorDisconnect = vi.fn();
    const gainDisconnect = vi.fn();
    const close = vi.fn(async () => undefined);
    class AudioContextStub {
      state: AudioContextState = 'running';
      sampleRate = 48_000;
      destination = {};
      audioWorklet = { addModule: vi.fn(async () => undefined) };
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect: sourceDisconnect };
      }
      createGain() {
        return {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: gainDisconnect,
        };
      }
      async suspend() {
        return undefined;
      }
      async resume() {
        return undefined;
      }
      async close() {
        this.state = 'closed';
        await close();
      }
    }
    class WorkletStub {
      port = { onmessage: null };
      connect = vi.fn();
      disconnect = processorDisconnect;
    }
    const socketConstructed = vi.fn();
    class SocketStub {
      static OPEN = 1;
      readyState = 0;
      constructor() {
        socketConstructed();
      }
      addEventListener = vi.fn();
      close = vi.fn();
    }
    vi.stubGlobal('AudioContext', AudioContextStub);
    vi.stubGlobal('AudioWorkletNode', WorkletStub);
    vi.stubGlobal('WebSocket', SocketStub);
    const stopTrack = vi.fn();
    const pipeline = new SpeechPipeline({
      sessionId: 'session_cleanup',
      stream: { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream,
      signal: new AbortController().signal,
      isCurrent: () => true,
      onTranscriptChanged: vi.fn(),
      onStatus: vi.fn(),
    });
    pipeline.start();
    await vi.waitFor(() => expect(socketConstructed).toHaveBeenCalledOnce());
    await pipeline.stop();
    expect(sourceDisconnect).toHaveBeenCalledOnce();
    expect(processorDisconnect).toHaveBeenCalledOnce();
    expect(gainDisconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
  });
});
