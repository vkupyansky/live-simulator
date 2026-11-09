import { describe, expect, it, vi } from 'vitest';
import { ObjectUrlRegistry, stopMediaStream } from '@/features/media/resources';
import { SessionStateMachine } from '@/features/session/lifecycle';

describe('session lifecycle and cleanup', () => {
  it('makes start and stop idempotent and permits a clean restart', async () => {
    let sequence = 0;
    const transitions: string[] = [];
    const machine = new SessionStateMachine({
      now: () => sequence * 100,
      createSessionId: () => `session_${++sequence}`,
      createSeed: () => sequence,
      onTransition: (snapshot) => transitions.push(snapshot.status),
    });
    let preparations = 0;
    let resolvePreparation: (() => void) | undefined;
    const prepare = () => {
      preparations += 1;
      return new Promise<void>((resolve) => {
        resolvePreparation = resolve;
      });
    };
    const first = machine.start(prepare);
    const duplicate = machine.start(prepare);
    expect(preparations).toBe(1);
    resolvePreparation?.();
    await Promise.all([first, duplicate]);
    expect(machine.snapshot().status).toBe('active');
    const firstSessionId = machine.snapshot().sessionId;
    const cleanup = vi.fn(async () => undefined);
    await Promise.all([machine.stop(cleanup), machine.stop(cleanup)]);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(machine.snapshot().status).toBe('idle');
    const restart = machine.start(async () => undefined);
    await restart;
    expect(machine.snapshot().sessionId).not.toBe(firstSessionId);
    expect(transitions).toContain('stopping');
  });

  it('rejects stale completion after stop and recovers from errors', async () => {
    let resolvePreparation: (() => void) | undefined;
    const machine = new SessionStateMachine({
      createSessionId: () => 'session_stale',
      createSeed: () => 9,
    });
    const start = machine.start(
      () =>
        new Promise<void>((resolve) => {
          resolvePreparation = resolve;
        }),
    );
    await machine.stop(() => undefined);
    resolvePreparation?.();
    await start;
    expect(machine.snapshot().status).toBe('idle');
    await machine.start(async () => {
      throw new Error('camera failed');
    });
    expect(machine.snapshot().status).toBe('error');
    expect(machine.recover().status).toBe('idle');
  });

  it('keeps a replacement preparation attached when a stale start finishes later', async () => {
    let firstDone: (() => void) | undefined;
    let replacementDone: (() => void) | undefined;
    const machine = new SessionStateMachine();
    const first = machine.start(
      async () =>
        await new Promise<void>((resolve) => {
          firstDone = resolve;
        }),
    );
    await machine.stop(() => undefined);
    const replacementPrepare = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          replacementDone = resolve;
        }),
    );
    const replacement = machine.start(replacementPrepare);

    firstDone?.();
    await first;
    const duplicatePrepare = vi.fn(async () => undefined);
    expect(machine.start(duplicatePrepare)).toBe(replacement);
    expect(duplicatePrepare).not.toHaveBeenCalled();

    replacementDone?.();
    await replacement;
    expect(machine.snapshot().status).toBe('active');
    expect(replacementPrepare).toHaveBeenCalledOnce();
  });

  it('always releases stopping state when a cleanup operation rejects', async () => {
    const machine = new SessionStateMachine({
      createSessionId: () => 'session_cleanup_failure',
      createSeed: () => 11,
    });
    await machine.start(async () => undefined);
    await expect(
      machine.stop(async () => {
        throw new Error('audio context refused to close');
      }),
    ).resolves.toMatchObject({ status: 'idle', sessionId: null });
    await expect(machine.start(async () => undefined)).resolves.toMatchObject({ status: 'active' });
  });

  it('stops media tracks and revokes every object URL', () => {
    const stop = vi.fn();
    stopMediaStream({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    expect(stop).toHaveBeenCalledOnce();
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const registry = new ObjectUrlRegistry();
    registry.create(new Blob());
    registry.create(new Blob());
    registry.revokeAll();
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(registry.size).toBe(0);
  });
});
