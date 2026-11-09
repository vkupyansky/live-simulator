import { createId } from '@/shared/lib/ids';

export type SessionStatus = 'idle' | 'preparing' | 'active' | 'stopping' | 'error';

export interface SessionIdentity {
  sessionId: string;
  seed: number;
  startedAt: number;
  signal: AbortSignal;
}

export interface SessionSnapshot {
  status: SessionStatus;
  sessionId: string | null;
  seed: number | null;
  startedAt: number | null;
  error: string;
}

export interface SessionMachineOptions {
  now?: () => number;
  createSessionId?: () => string;
  createSeed?: () => number;
  onTransition?: (snapshot: SessionSnapshot) => void;
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}

export class SessionStateMachine {
  private status: SessionStatus = 'idle';
  private identity: SessionIdentity | null = null;
  private controller: AbortController | null = null;
  private error = '';
  private startPromise: Promise<SessionSnapshot> | null = null;
  private stopPromise: Promise<SessionSnapshot> | null = null;
  private readonly now: () => number;
  private readonly createSessionId: () => string;
  private readonly createSeed: () => number;

  constructor(private readonly options: SessionMachineOptions = {}) {
    this.now = options.now ?? performance.now.bind(performance);
    this.createSessionId = options.createSessionId ?? (() => createId('session'));
    this.createSeed = options.createSeed ?? randomSeed;
  }

  snapshot(): SessionSnapshot {
    return {
      status: this.status,
      sessionId: this.identity?.sessionId ?? null,
      seed: this.identity?.seed ?? null,
      startedAt: this.identity?.startedAt ?? null,
      error: this.error,
    };
  }

  private transition(status: SessionStatus, error = ''): SessionSnapshot {
    this.status = status;
    this.error = error;
    const snapshot = this.snapshot();
    this.options.onTransition?.(snapshot);
    return snapshot;
  }

  start(prepare: (identity: SessionIdentity) => Promise<void>): Promise<SessionSnapshot> {
    if (this.status === 'preparing' || this.status === 'active')
      return this.startPromise ?? Promise.resolve(this.snapshot());
    if (this.status === 'stopping') return Promise.resolve(this.snapshot());
    const controller = new AbortController();
    this.controller = controller;
    this.identity = {
      sessionId: this.createSessionId(),
      seed: this.createSeed(),
      startedAt: this.now(),
      signal: controller.signal,
    };
    const current = this.identity;
    this.transition('preparing');
    const operation = (async () => {
      try {
        await prepare(current);
        if (this.identity !== current || current.signal.aborted) return this.snapshot();
        return this.transition('active');
      } catch (error) {
        if (this.identity !== current || current.signal.aborted) return this.snapshot();
        controller.abort();
        this.controller = null;
        this.identity = null;
        return this.transition(
          'error',
          error instanceof Error ? error.message : 'Не удалось подготовить сессию.',
        );
      }
    })();
    this.startPromise = operation;
    const releaseOperation = () => {
      // A stopped preparation may finish after a replacement session has already started.
      // Never let that stale completion clear the replacement's in-flight promise.
      if (this.startPromise === operation) this.startPromise = null;
    };
    void operation.then(releaseOperation, releaseOperation);
    return operation;
  }

  stop(cleanup: () => Promise<void> | void): Promise<SessionSnapshot> {
    if (this.status === 'idle') return Promise.resolve(this.snapshot());
    if (this.status === 'stopping') return this.stopPromise ?? Promise.resolve(this.snapshot());
    const current = this.identity;
    this.transition('stopping');
    this.controller?.abort();
    this.stopPromise = (async () => {
      try {
        await cleanup();
      } catch {
        // Cleanup is best-effort: a released session must never remain trapped in `stopping`.
      }
      if (this.identity === current) this.identity = null;
      this.controller = null;
      this.stopPromise = null;
      this.startPromise = null;
      return this.transition('idle');
    })();
    return this.stopPromise;
  }

  abortCurrent(): void {
    this.controller?.abort();
  }

  recover(): SessionSnapshot {
    if (this.status !== 'error') return this.snapshot();
    this.identity = null;
    this.controller = null;
    return this.transition('idle');
  }

  isCurrent(sessionId: string): boolean {
    return this.identity?.sessionId === sessionId && !this.identity.signal.aborted;
  }
}
