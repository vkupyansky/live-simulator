import { describe, expect, it, vi } from 'vitest';
import { SpeechPipeline } from '@/features/speech/pipeline';
import { SpeechTurnFinalizer } from '@/features/speech/turnFinalizer';

describe('speech turn finalization', () => {
  it('debounces final fragments into one host turn and removes its timer', () => {
    vi.useFakeTimers();
    const onTurn = vi.fn();
    const finalizer = new SpeechTurnFinalizer({ onTurn, debounceMs: 250 });
    finalizer.push({ transcript: 'давайте поговорим', durationMs: 700 });
    finalizer.push({ transcript: 'задавайте вопросы', durationMs: 600 });
    vi.advanceTimersByTime(249);
    expect(onTurn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTurn).toHaveBeenCalledOnce();
    expect(onTurn).toHaveBeenCalledWith({
      transcript: 'давайте поговорим задавайте вопросы',
      durationMs: 1_300,
    });
    finalizer.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes an overloaded fragment burst before its pending memory can grow unbounded', () => {
    vi.useFakeTimers();
    const onTurn = vi.fn();
    const finalizer = new SpeechTurnFinalizer({ onTurn, debounceMs: 250 });
    for (let index = 0; index < 9; index += 1) finalizer.push({ transcript: `фрагмент ${index}` });

    expect(onTurn).toHaveBeenCalledOnce();
    expect(onTurn.mock.calls[0]?.[0].transcript).toContain('фрагмент 7');
    vi.advanceTimersByTime(250);
    expect(onTurn).toHaveBeenCalledTimes(2);
    expect(onTurn.mock.calls[1]?.[0].transcript).toBe('фрагмент 8');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not emit a late error when stop wins an in-flight worklet initialization', async () => {
    let resolveWorklet: (() => void) | undefined;
    const close = vi.fn(async () => undefined);
    class DeferredAudioContext {
      state: AudioContextState = 'running';
      sampleRate = 48_000;
      audioWorklet = {
        addModule: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveWorklet = resolve;
            }),
        ),
      };

      async close(): Promise<void> {
        this.state = 'closed';
        await close();
      }
    }
    vi.stubGlobal('AudioContext', DeferredAudioContext);
    const stopTrack = vi.fn();
    const controller = new AbortController();
    const onStatus = vi.fn();
    const pipeline = new SpeechPipeline({
      sessionId: 'session_speech_race',
      stream: { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream,
      signal: controller.signal,
      isCurrent: () => true,
      onTranscriptChanged: vi.fn(),
      onStatus,
    });

    pipeline.start();
    await vi.waitFor(() => expect(resolveWorklet).toBeTypeOf('function'));
    await pipeline.stop();
    resolveWorklet?.();
    await Promise.resolve();

    expect(close).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(onStatus).not.toHaveBeenCalledWith('error', expect.any(String));
  });
});
