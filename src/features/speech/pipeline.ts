import { TranscriptWindow } from '@/features/speech/transcript';
import { SpeechTurnFinalizer, type FinalSpeechTurn } from '@/features/speech/turnFinalizer';
import { stopMediaStream } from '@/features/media/resources';

const PCM_WORKLET_URL = '/pcm-worklet.js';
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_EXPONENT_LIMIT = Math.ceil(Math.log2(RECONNECT_MAX_MS / RECONNECT_BASE_MS));
const MAX_BUFFERED_AUDIO_BYTES = 256 * 1024;
const AUDIO_CONTEXT_CLOSE_TIMEOUT_MS = 1_000;

interface StreamMessage {
  type: 'ready' | 'transcript' | 'error';
  transcript?: string;
  language?: string;
  durationMs?: number;
  code?: string;
  retryable?: boolean;
}

async function closeAudioContext(context: AudioContext): Promise<void> {
  if (context.state === 'closed') return;
  let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
  const close = context.close().catch(() => undefined);
  await Promise.race([
    close,
    new Promise<void>((resolve) => {
      timeout = globalThis.setTimeout(resolve, AUDIO_CONTEXT_CLOSE_TIMEOUT_MS);
    }),
  ]);
  if (timeout) globalThis.clearTimeout(timeout);
}

export interface SpeechPipelineOptions {
  sessionId: string;
  stream: MediaStream;
  signal: AbortSignal;
  isCurrent(): boolean;
  onTranscriptChanged(): void;
  onStatus(status: 'active' | 'paused' | 'recovering' | 'error', message?: string): void;
  now?: () => number;
}

function parseStreamMessage(value: unknown): StreamMessage | null {
  if (typeof value !== 'string' || value.length > 4_000) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!['ready', 'transcript', 'error'].includes(String(parsed.type))) return null;
    return {
      type: parsed.type as StreamMessage['type'],
      ...(typeof parsed.transcript === 'string' ? { transcript: parsed.transcript } : {}),
      ...(typeof parsed.language === 'string' ? { language: parsed.language } : {}),
      ...(typeof parsed.durationMs === 'number' ? { durationMs: parsed.durationMs } : {}),
      ...(typeof parsed.code === 'string' ? { code: parsed.code } : {}),
      ...(typeof parsed.retryable === 'boolean' ? { retryable: parsed.retryable } : {}),
    };
  } catch {
    return null;
  }
}

function streamUrl(sessionId: string, sampleRate: number): string {
  const url = new URL('/api/v1/transcriptions/stream', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('sampleRate', String(sampleRate));
  return url.toString();
}

export class SpeechPipeline {
  readonly transcript = new TranscriptWindow();
  private readonly now: () => number;
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private mutedOutput: GainNode | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private paused = false;
  private reconnectAttempts = 0;
  private sequence = 0;
  private readonly turnFinalizer: SpeechTurnFinalizer;
  private stopPromise: Promise<void> | null = null;

  constructor(private readonly options: SpeechPipelineOptions) {
    this.now = options.now ?? performance.now.bind(performance);
    this.turnFinalizer = new SpeechTurnFinalizer({ onTurn: (turn) => this.commitTurn(turn) });
  }

  private readonly onSessionAbort = () => {
    void this.stop();
  };

  start(): void {
    if (this.running || this.stopPromise) return;
    if (this.options.signal.aborted) {
      void this.stop();
      return;
    }
    this.running = true;
    this.paused = false;
    this.options.signal.addEventListener('abort', this.onSessionAbort, { once: true });
    this.options.onStatus('recovering');
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    let context: AudioContext | null = null;
    try {
      context = new AudioContext({ latencyHint: 'interactive' });
      this.audioContext = context;
      await context.audioWorklet.addModule(PCM_WORKLET_URL);
      if (!this.running || this.options.signal.aborted || this.audioContext !== context) {
        if (!this.stopPromise) await closeAudioContext(context);
        if (this.audioContext === context) this.audioContext = null;
        return;
      }
      const source = context.createMediaStreamSource(this.options.stream);
      const processor = new AudioWorkletNode(context, 'pcm-capture');
      const mutedOutput = context.createGain();
      mutedOutput.gain.value = 0;
      processor.port.onmessage = (event: MessageEvent<unknown>) => {
        if (!(event.data instanceof ArrayBuffer)) return;
        const socket = this.socket;
        const bufferedBytes = socket?.bufferedAmount ?? 0;
        if (socket?.readyState === WebSocket.OPEN && bufferedBytes <= MAX_BUFFERED_AUDIO_BYTES)
          socket.send(event.data);
      };
      source.connect(processor);
      processor.connect(mutedOutput);
      mutedOutput.connect(context.destination);
      this.source = source;
      this.processor = processor;
      this.mutedOutput = mutedOutput;
      await context.suspend();
      if (this.running && !this.paused) this.connect();
    } catch {
      if (context && !this.stopPromise) await closeAudioContext(context);
      if (this.audioContext === context) this.audioContext = null;
      if (this.running && !this.options.signal.aborted) {
        this.running = false;
        this.options.onStatus('error', 'Потоковое распознавание речи недоступно в этом браузере.');
        void this.stop();
      }
    }
  }

  private connect(): void {
    const context = this.audioContext;
    if (!this.running || this.paused || !context || this.socket || this.options.signal.aborted)
      return;
    const socket = new WebSocket(streamUrl(this.options.sessionId, context.sampleRate));
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    socket.addEventListener('message', (event) => this.handleMessage(socket, event.data));
    socket.addEventListener('error', () => socket.close());
    socket.addEventListener('close', () => this.handleClose(socket));
  }

  private handleMessage(socket: WebSocket, payload: unknown): void {
    if (socket !== this.socket || !this.running) return;
    const message = parseStreamMessage(payload);
    if (!message) return;
    if (message.type === 'ready') {
      this.reconnectAttempts = 0;
      void this.audioContext?.resume();
      this.options.onStatus('active');
      return;
    }
    if (message.type === 'error') {
      if (message.retryable === false) {
        this.running = false;
        this.options.onStatus('error', 'Модель потоковой речи недоступна.');
        void this.stop();
      } else this.options.onStatus('recovering');
      socket.close();
      return;
    }
    const text = message.transcript;
    if (!text || !this.options.isCurrent()) return;
    this.turnFinalizer.push({
      transcript: text,
      ...(message.language ? { language: message.language } : {}),
      ...(message.durationMs === undefined ? {} : { durationMs: message.durationMs }),
    });
  }

  private commitTurn(turn: FinalSpeechTurn): void {
    if (!this.running || !this.options.isCurrent()) return;
    const endedAtMs = this.now();
    const durationMs = Math.max(0, Math.min(30_000, turn.durationMs ?? 0));
    if (
      this.transcript.add(
        {
          sequence: ++this.sequence,
          text: turn.transcript,
          startedAtMs: Math.max(0, endedAtMs - durationMs),
          endedAtMs,
          ...(turn.language ? { language: turn.language } : {}),
        },
        endedAtMs,
      )
    )
      this.options.onTranscriptChanged();
  }

  private handleClose(socket: WebSocket): void {
    if (socket !== this.socket) return;
    this.socket = null;
    if (!this.running || this.paused || this.options.signal.aborted) return;
    void this.audioContext?.suspend();
    this.options.onStatus('recovering');
    const exponent = Math.min(this.reconnectAttempts, RECONNECT_EXPONENT_LIMIT);
    const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** exponent);
    const delay = Math.round(ceiling * (0.75 + Math.random() * 0.5));
    this.reconnectAttempts = Math.min(this.reconnectAttempts + 1, RECONNECT_EXPONENT_LIMIT);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.turnFinalizer.flush();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, 'paused');
    this.socket = null;
    void this.audioContext?.suspend();
    this.options.onStatus('paused');
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.options.onStatus('recovering');
    this.connect();
  }

  stop(): Promise<void> {
    this.stopPromise ??= this.releaseResources();
    return this.stopPromise;
  }

  private async releaseResources(): Promise<void> {
    this.running = false;
    this.paused = false;
    this.options.signal.removeEventListener('abort', this.onSessionAbort);
    this.turnFinalizer.cancel();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const socket = this.socket;
    this.socket = null;
    try {
      socket?.close(1000, 'session-ended');
    } catch {
      // A connecting browser socket can reject close; dropping the reference is sufficient.
    }
    if (this.processor) this.processor.port.onmessage = null;
    this.source?.disconnect();
    this.processor?.disconnect();
    this.mutedOutput?.disconnect();
    this.source = null;
    this.processor = null;
    this.mutedOutput = null;
    const context = this.audioContext;
    this.audioContext = null;
    stopMediaStream(this.options.stream);
    this.transcript.clear();
    if (context) await closeAudioContext(context);
  }
}
